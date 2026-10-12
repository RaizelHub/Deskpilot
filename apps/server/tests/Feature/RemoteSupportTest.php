<?php

namespace Tests\Feature;

use App\Models\Device;
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
        $this->device->update(['last_seen_at' => now()]);
        Ticket::find($this->payload['ticket_id'])->update(['requester_id' => $this->tech->id]);
        $this->postJson('/api/v1/remote-sessions', $this->payload)->assertUnprocessable();
    }
}
