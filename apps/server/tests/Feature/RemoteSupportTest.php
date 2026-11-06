<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\Device;
use App\Models\Permission;
use App\Models\RemoteSession;
use App\Models\Role;
use App\Models\Ticket;
use App\Models\TicketCategory;
use App\Models\User;
use App\Services\RemoteSupportService;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class RemoteSupportTest extends TestCase
{
    use RefreshDatabase;

    private User $tech;

    private User $customer;

    private User $other;

    private Device $device;

    private array $payload;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tech = $this->account('super-administrator');
        $this->customer = $this->account('employee');
        $this->other = $this->account('employee');
        $this->device = Device::create(['name' => 'Support PC', 'hostname' => 'SUPPORT-PC', 'agent_version' => '0.6.0', 'last_seen_at' => now()]);
        $t = $this->actingAs($this->customer)->postJson('/api/v1/tickets', ['title' => 'Connection issue', 'description' => 'Please help with the connection.', 'priority' => 'medium', 'category_id' => TicketCategory::first()->id, 'tags' => []])->assertCreated()->json('data.id');
        $this->payload = ['device_id' => $this->device->id, 'ticket_id' => $t, 'mode' => 'control', 'reason' => 'Diagnose customer connection', 'request_key' => (string) Str::uuid()];
    }

    private function account(string $role): User
    {
        $u = User::factory()->create(['is_active' => true]);
        $u->roles()->attach(Role::where('slug', $role)->firstOrFail());

        return $u;
    }

    private function requestSupport(): string
    {
        return $this->actingAs($this->tech)->postJson('/api/v1/remote-sessions', $this->payload)->assertCreated()->assertJsonMissingPath('data.request_ip')->json('data.id');
    }

    private function act(string $id, string $action)
    {
        return $this->postJson('/api/v1/remote-sessions/'.$id.'/actions', ['action' => $action]);
    }

    public function test_only_named_customer_can_consent_and_consent_never_means_connected(): void
    {
        $id = $this->requestSupport();
        $this->act($id, 'control')->assertForbidden();
        $this->actingAs($this->other)->getJson('/api/v1/remote-sessions/'.$id)->assertNotFound();
        $this->act($id, 'view')->assertNotFound();
        $this->getJson('/api/v1/my-support-requests')->assertJsonPath('total', 0);
        $this->actingAs($this->customer)->getJson('/api/v1/my-support-requests')->assertJsonPath('total', 1);
        $this->act($id, 'viewed')->assertOk()->assertJsonPath('data.status', 'waiting_for_user');
        $this->act($id, 'view')->assertOk()->assertJsonPath('data.status', 'approved')->assertJsonPath('data.approved_mode', 'view')->assertJsonMissingPath('data.consent_ip');
        $this->act($id, 'view')->assertOk();
        $this->act($id, 'control')->assertConflict();
        $this->getJson('/api/v1/remote-support/capabilities')->assertJsonPath('live_connections', false)->assertJsonPath('unattended', false);
        $this->act($id, 'connected')->assertUnprocessable();
        $this->act($id, 'cancel')->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->act($id, 'cancel')->assertOk();
        $this->assertDatabaseCount('remote_session_events', 4);
    }

    public function test_idempotency_one_pending_request_and_input_tampering(): void
    {
        $id = $this->requestSupport();
        $this->assertSame($id, $this->requestSupport());
        $this->assertDatabaseCount('remote_sessions', 1);
        $this->postJson('/api/v1/remote-sessions', [...$this->payload, 'request_key' => (string) Str::uuid()])->assertConflict();
        $this->postJson('/api/v1/remote-sessions', [...$this->payload, 'reason' => 'Changed reason'])->assertConflict();
        $this->postJson('/api/v1/remote-sessions', [...$this->payload, 'status' => 'connected'])->assertUnprocessable();
        $this->actingAs($this->customer)->postJson('/api/v1/remote-sessions', $this->payload)->assertForbidden();
        $this->postJson('/api/v1/remote-sessions/'.$id.'/actions', ['action' => 'view', 'customer_id' => $this->other->id])->assertUnprocessable();
    }

    public function test_view_only_cannot_be_upgraded_and_decline_is_final(): void
    {
        $this->payload['mode'] = 'view';
        $id = $this->requestSupport();
        $this->actingAs($this->customer);
        $this->act($id, 'control')->assertUnprocessable();
        $this->act($id, 'decline')->assertOk()->assertJsonPath('data.status', 'declined');
        $this->act($id, 'decline')->assertOk();
        $this->act($id, 'view')->assertConflict();
    }

    public function test_expiry_revocation_and_role_loss_cancel_authorization(): void
    {
        $id = $this->requestSupport();
        $this->actingAs($this->customer);
        $this->act($id, 'control')->assertOk();
        $this->travel(121)->seconds();
        app(RemoteSupportService::class)->sweep();
        $this->assertSame('expired', RemoteSession::find($id)->status);
        $this->act($id, 'control')->assertConflict();
        $this->device->update(['last_seen_at' => now()]);
        $this->payload['request_key'] = (string) Str::uuid();
        $id = $this->requestSupport();
        $this->postJson('/api/v1/devices/'.$this->device->id.'/revoke', ['reason' => 'Device retired'])->assertOk();
        $this->assertSame('cancelled', RemoteSession::find($id)->status);
        $this->device->update(['revoked_at' => null, 'last_seen_at' => now()]);
        $this->payload['request_key'] = (string) Str::uuid();
        $id = $this->requestSupport();
        $this->tech->roles()->detach();
        app(RemoteSupportService::class)->sweep();
        $this->assertSame('cancelled', RemoteSession::find($id)->status);
    }

    public function test_device_poll_contains_no_customer_details_and_cannot_record_consent(): void
    {
        $id = $this->requestSupport();
        $s = app(RemoteSupportService::class);
        $data = $s->poll($this->device);
        $this->assertSame($id, $data['id']);
        $this->assertSame(['id', 'expires_at'], array_keys($data));
        $s->poll($this->device);
        $this->assertDatabaseCount('remote_session_events', 2);
        $this->assertSame('requested', RemoteSession::find($id)->status);
        config(['deskpilot.agent_allow_loopback_http' => true]);
        $this->postJson('/api/v1/agent/remote-support/poll', [])->assertUnauthorized();
    }

    public function test_old_or_offline_agents_and_self_approval_are_rejected(): void
    {
        $this->device->update(['agent_version' => '0.5.0']);
        $this->actingAs($this->tech)->postJson('/api/v1/remote-sessions', $this->payload)->assertConflict();
        $this->device->update(['agent_version' => '0.6.0', 'last_seen_at' => now()->subMinutes(4)]);
        $this->postJson('/api/v1/remote-sessions', $this->payload)->assertConflict();
        $this->device->update(['last_seen_at' => now()->subSeconds(95)]);
        $this->postJson('/api/v1/remote-sessions', $this->payload)->assertConflict()->assertJsonPath('message', 'Device heartbeat is overdue. Wait for device to check in before requesting remote support.');
        $this->device->update(['last_seen_at' => now()]);
        Ticket::find($this->payload['ticket_id'])->update(['requester_id' => $this->tech->id]);
        $this->postJson('/api/v1/remote-sessions', $this->payload)->assertUnprocessable();
    }
    public function test_remote_session_security_lifecycle_and_unauthorized_isolation(): void
    {
        // 1. Verify remote session requires approval and cannot establish connection while pending
        $id = $this->requestSupport();
        $session = RemoteSession::findOrFail($id);
        $this->assertSame('requested', $session->status);
        $this->assertNull($session->approved_at);
        $this->assertNull($session->approved_mode);

        // Requesting tech cannot self-approve or force connection
        $this->actingAs($this->tech)->postJson('/api/v1/remote-sessions/'.$id.'/actions', ['action' => 'view'])->assertForbidden();
        $this->actingAs($this->tech)->postJson('/api/v1/remote-sessions/'.$id.'/actions', ['action' => 'control'])->assertForbidden();
        $this->actingAs($this->tech)->postJson('/api/v1/remote-sessions/'.$id.'/actions', ['action' => 'connected'])->assertUnprocessable();

        // 2. Verify unauthorized technicians cannot join or view
        $unauthorizedTech = $this->account('it-technician');
        $this->actingAs($unauthorizedTech)->getJson('/api/v1/remote-sessions/'.$id)->assertNotFound();
        $this->actingAs($unauthorizedTech)->postJson('/api/v1/remote-sessions/'.$id.'/actions', ['action' => 'cancel'])->assertNotFound();
        $this->actingAs($unauthorizedTech)->postJson('/api/v1/remote-sessions/'.$id.'/actions', ['action' => 'view'])->assertNotFound();

        // User without remote.request / devices.view is forbidden from creating or listing sessions
        $helpdesk = $this->account('helpdesk-agent');
        $this->actingAs($helpdesk)->getJson('/api/v1/remote-sessions')->assertForbidden();
        $this->actingAs($helpdesk)->postJson('/api/v1/remote-sessions', $this->payload)->assertForbidden();

        // Technician without remote.control cannot request control mode
        $device2 = Device::create(['name' => 'Support PC 2', 'hostname' => 'SUPPORT-PC-2', 'agent_version' => '0.6.0', 'last_seen_at' => now()]);
        $viewOnlyRole = Role::create(['name' => 'View Only Technician', 'slug' => 'view-only-tech']);
        $viewOnlyRole->permissions()->sync(
            Permission::whereIn('name', ['devices.view', 'remote.request', 'tickets.view'])->pluck('id')
        );
        $viewOnlyTech = User::factory()->create(['is_active' => true]);
        $viewOnlyTech->roles()->attach($viewOnlyRole);

        $this->actingAs($viewOnlyTech)->postJson('/api/v1/remote-sessions', [
            ...$this->payload,
            'device_id' => $device2->id,
            'request_key' => (string) Str::uuid(),
            'mode' => 'control',
        ])->assertForbidden();

        // 3. Confirm customer approval is required and records consent
        $this->actingAs($this->customer);
        $this->act($id, 'view')->assertOk()->assertJsonPath('data.status', 'approved');

        // 4. Confirm disconnect (cancel) immediately stops remote access
        $this->act($id, 'cancel')->assertOk()->assertJsonPath('data.status', 'cancelled');
        $refreshed = RemoteSession::findOrFail($id);
        $this->assertSame('cancelled', $refreshed->status);
        $this->assertNotNull($refreshed->finished_at);

        // Device poll returns null immediately after disconnect
        $this->assertNull(app(RemoteSupportService::class)->poll($this->device));

        // Reconnect attempt on cancelled session fails
        $this->act($id, 'view')->assertConflict();
        $this->act($id, 'control')->assertConflict();

        // 5. Confirm rejected requests cannot establish a connection
        $newPayload = [...$this->payload, 'request_key' => (string) Str::uuid()];
        $newId = $this->actingAs($this->tech)->postJson('/api/v1/remote-sessions', $newPayload)->assertCreated()->json('data.id');
        $this->actingAs($this->customer)->postJson('/api/v1/remote-sessions/'.$newId.'/actions', ['action' => 'decline'])->assertOk()->assertJsonPath('data.status', 'declined');

        $declinedSession = RemoteSession::findOrFail($newId);
        $this->assertSame('declined', $declinedSession->status);
        $this->assertNotNull($declinedSession->finished_at);

        // Device poll returns null for declined session
        $this->assertNull(app(RemoteSupportService::class)->poll($this->device));

        // Cannot approve or connect to declined session
        $this->actingAs($this->customer)->postJson('/api/v1/remote-sessions/'.$newId.'/actions', ['action' => 'view'])->assertConflict();
        $this->actingAs($this->customer)->postJson('/api/v1/remote-sessions/'.$newId.'/actions', ['action' => 'control'])->assertConflict();
    }

    public function test_cross_department_device_authorization_rejection_and_reconciliation(): void
    {
        $deptFinance = Department::create(['name' => 'Finance']);
        $deptMarketing = Department::create(['name' => 'Marketing']);

        // Assign fixture device to Finance department
        $financeDevice = Device::create([
            'name' => 'Finance PC',
            'hostname' => 'FINANCE-PC',
            'agent_version' => '0.6.0',
            'department_id' => $deptFinance->id,
            'last_seen_at' => now(),
        ]);

        // Customer in Marketing files a ticket
        $marketingCustomer = $this->account('employee');
        $marketingCustomer->update(['department_id' => $deptMarketing->id]);
        $marketingTicket = $this->actingAs($marketingCustomer)->postJson('/api/v1/tickets', [
            'title' => 'Marketing printer broken',
            'description' => 'Cannot print flyers.',
            'priority' => 'low',
            'category_id' => TicketCategory::first()->id,
            'tags' => [],
        ])->assertCreated()->json('data.id');

        // Technician attempts to request remote access to Finance Device using Marketing Ticket -> Rejected 422
        $this->actingAs($this->tech)->postJson('/api/v1/remote-sessions', [
            'device_id' => $financeDevice->id,
            'ticket_id' => $marketingTicket,
            'mode' => 'control',
            'reason' => 'Inspect printer driver remotely',
            'request_key' => (string) Str::uuid(),
        ])->assertUnprocessable()->assertJsonPath('message', 'The ticket department does not match the device department.');

        // Customer in Finance files a ticket
        $financeCustomer = $this->account('employee');
        $financeCustomer->update(['department_id' => $deptFinance->id]);
        $financeTicket = $this->actingAs($financeCustomer)->postJson('/api/v1/tickets', [
            'title' => 'Finance ERP crash',
            'description' => 'Need payroll assistance.',
            'priority' => 'high',
            'category_id' => TicketCategory::first()->id,
            'tags' => [],
        ])->assertCreated()->json('data.id');

        // Requesting remote access for Finance Device with Finance Ticket -> Succeeded
        $validId = $this->actingAs($this->tech)->postJson('/api/v1/remote-sessions', [
            'device_id' => $financeDevice->id,
            'ticket_id' => $financeTicket,
            'mode' => 'control',
            'reason' => 'Fix ERP payroll crash',
            'request_key' => (string) Str::uuid(),
        ])->assertCreated()->json('data.id');

        // When device is moved to another department while session is active -> Reconcile cancels session
        $financeDevice->update(['department_id' => $deptMarketing->id]);
        app(RemoteSupportService::class)->reconcile($financeDevice);

        $session = RemoteSession::findOrFail($validId);
        $this->assertSame('cancelled', $session->status);
        $this->assertStringContainsString('Department boundary violation', $session->end_reason);
    }

    public function test_show_endpoint_synchronously_reconciles_expired_session(): void
    {
        $id = $this->requestSupport();

        // Advance clock past the 5-minute request expiration deadline
        $this->travel(305)->seconds();

        // Reading the session via show endpoint immediately detects expiry without relying on cron sweep
        $response = $this->actingAs($this->tech)->getJson('/api/v1/remote-sessions/'.$id)->assertOk();
        $this->assertSame('expired', $response->json('data.status'));

        $this->travelBack();
    }
}
