<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\Role;
use App\Models\Ticket;
use App\Models\TicketCategory;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class HelpdeskTest extends TestCase
{
    use RefreshDatabase;

    private User $staff;

    private User $employee;

    private User $other;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->staff = $this->account('it-technician');
        $this->employee = $this->account('employee');
        $this->other = $this->account('employee');
        Storage::fake('tickets');
    }

    private function account(string $role): User
    {
        $u = User::factory()->create(['is_active' => true]);
        $u->roles()->attach(Role::where('slug', $role)->firstOrFail());

        return $u;
    }

    private function createTicket(array $extra = []): array
    {
        return $this->actingAs($this->employee)->postJson('/api/v1/tickets', array_merge(['title' => 'VPN connection failed', 'description' => 'Cannot reach office applications.', 'priority' => 'high', 'category_id' => TicketCategory::first()->id, 'tags' => ['vpn']], $extra))->assertCreated()->json('data');
    }

    private function updateTicket(array $t, array $data)
    {
        return $this->actingAs($this->staff)->patchJson('/api/v1/tickets/'.$t['id'], array_merge(['version' => $t['version']], $data));
    }

    public function test_ticket_numbers_scope_and_employee_permissions(): void
    {
        $a = $this->createTicket();
        $b = $this->createTicket();
        $this->assertNotEquals($a['number'], $b['number']);
        $this->assertMatchesRegularExpression('/^INC-\d{4}-\d{6}$/', $a['number']);
        $this->actingAs($this->other)->getJson('/api/v1/tickets')->assertJsonPath('meta.total', 0);
        foreach (['', '/comments', '/history', '/attachments'] as $suffix) {
            $this->getJson('/api/v1/tickets/'.$a['id'].$suffix)->assertNotFound();
        }
        $this->actingAs($this->employee)->patchJson('/api/v1/tickets/'.$a['id'], ['version' => 1, 'priority' => 'critical'])->assertForbidden();
        $this->postJson('/api/v1/tickets', ['title' => 'Other request', 'description' => 'Long description', 'priority' => 'low', 'category_id' => $a['category_id'], 'requester_id' => $this->other->id])->assertForbidden();
        $this->actingAs($this->staff)->getJson('/api/v1/tickets?tag=vpn&priority=high&search=VPN')->assertJsonPath('meta.total', 2);
    }

    public function test_lifecycle_conflicts_resolution_and_reopening(): void
    {
        $t = $this->createTicket();
        $this->updateTicket($t, ['status' => 'in_progress'])->assertUnprocessable();
        $this->updateTicket($t, ['assignee_id' => $this->employee->id])->assertUnprocessable();
        $t = $this->updateTicket($t, ['assignee_id' => $this->staff->id])->assertOk()->assertJsonPath('data.status', 'assigned')->json('data');
        $this->updateTicket($t, ['version' => 1, 'priority' => 'critical'])->assertConflict();
        $this->updateTicket($t, ['status' => 'closed'])->assertUnprocessable();
        $this->updateTicket($t, ['status' => 'resolved'])->assertUnprocessable();
        $t = $this->updateTicket($t, ['status' => 'resolved', 'resolution_notes' => 'Reset VPN profile.'])->assertOk()->json('data');
        $this->assertNotNull($t['resolved_at']);
        $t = $this->updateTicket($t, ['status' => 'closed'])->assertOk()->json('data');
        $this->postJson('/api/v1/tickets/'.$t['id'].'/comments', ['body' => 'Late reply'])->assertUnprocessable();
        $this->actingAs($this->employee)->postJson('/api/v1/tickets/'.$t['id'].'/reopen', ['version' => $t['version'], 'reason' => 'Problem returned'])->assertOk()->assertJsonPath('data.status', 'assigned')->assertJsonPath('data.resolved_at', null);
        $this->getJson('/api/v1/tickets/'.$t['id'].'/history')->assertJsonFragment(['action' => 'reopened']);
    }

    public function test_internal_notes_are_private_and_requester_reply_resumes_work(): void
    {
        $t = $this->createTicket();
        $t = $this->updateTicket($t, ['assignee_id' => $this->staff->id, 'status' => 'waiting_for_user'])->assertOk()->json('data');
        $url = '/api/v1/tickets/'.$t['id'];
        $this->postJson($url.'/comments', ['body' => 'Private staff note', 'is_internal' => true])->assertCreated();
        $this->assertNull(Ticket::find($t['id'])->first_response_at);
        $this->postJson($url.'/comments', ['body' => 'Please retry the connection'])->assertCreated();
        $this->assertNotNull(Ticket::find($t['id'])->first_response_at);
        $this->actingAs($this->employee)->getJson($url.'/comments')->assertJsonCount(1, 'data')->assertJsonMissing(['body' => 'Private staff note']);
        $this->getJson($url.'/history')->assertJsonMissing(['action' => 'internal_note_added']);
        $this->postJson($url.'/comments', ['body' => 'Forged note', 'is_internal' => true])->assertForbidden();
        $this->postJson($url.'/comments', ['body' => 'Still failing'])->assertCreated();
        $this->assertDatabaseHas('tickets', ['id' => $t['id'], 'status' => 'in_progress']);
    }

    public function test_private_files_validation_download_and_deletion(): void
    {
        $t = $this->createTicket();
        $url = '/api/v1/tickets/'.$t['id'].'/attachments';
        $a = $this->postJson($url, ['file' => UploadedFile::fake()->createWithContent('error.txt', 'Connection refused on port 443.')])->assertCreated()->assertJsonMissingPath('data.storage_path')->json('data');
        $this->get($url.'/'.$a['id'])->assertOk()->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->actingAs($this->other)->getJson($url.'/'.$a['id'])->assertNotFound();
        $this->actingAs($this->staff);
        $private = $this->postJson($url, ['file' => UploadedFile::fake()->image('screen.png'), 'is_internal' => true])->assertCreated()->json('data');
        $this->actingAs($this->employee)->getJson($url)->assertJsonCount(1, 'data');
        $this->getJson($url.'/'.$private['id'])->assertNotFound();
        $this->deleteJson($url.'/'.$private['id'])->assertNotFound();
        $this->postJson($url, ['file' => UploadedFile::fake()->createWithContent('fake.png', 'not an image')])->assertUnprocessable();
        $this->postJson($url, ['file' => UploadedFile::fake()->createWithContent('payload.html', '<html>hello</html>')])->assertUnprocessable();
        $this->deleteJson($url.'/'.$a['id'])->assertNoContent();
        $this->getJson($url.'/'.$a['id'])->assertNotFound();
    }

    public function test_bulk_is_atomic_and_dashboard_is_scoped(): void
    {
        $a = $this->createTicket();
        $b = $this->createTicket();
        $this->actingAs($this->staff)->postJson('/api/v1/tickets/bulk', ['items' => [['id' => $a['id'], 'version' => 1], ['id' => $b['id'], 'version' => 99]], 'changes' => ['priority' => 'critical']])->assertConflict();
        $this->assertDatabaseCount('tickets', 2);
        $this->assertEquals(0, Ticket::where('priority', 'critical')->count());
        $this->postJson('/api/v1/tickets/bulk', ['items' => [['id' => $a['id'], 'version' => 1], ['id' => $b['id'], 'version' => 1]], 'changes' => ['priority' => 'critical']])->assertOk();
        $this->getJson('/api/v1/dashboard')->assertOk()->assertJsonPath('tickets.open', 2)->assertJsonPath('tickets.critical', 2);
        $this->actingAs($this->other)->getJson('/api/v1/dashboard')->assertOk()->assertJsonPath('tickets.open', 0);
    }

    public function test_department_manager_scope(): void
    {
        $department = Department::create(['name' => 'Operations']);
        $this->employee->update(['department_id' => $department->id]);
        $t = $this->createTicket();
        $manager = $this->account('department-manager');
        $manager->update(['department_id' => $department->id]);
        $this->actingAs($manager)->getJson('/api/v1/tickets/'.$t['id'])->assertOk();
        $this->postJson('/api/v1/tickets/'.$t['id'].'/comments', ['body' => 'Unauthorized reply'])->assertForbidden();
        $manager->update(['department_id' => null]);
        $this->getJson('/api/v1/tickets/'.$t['id'])->assertNotFound();
    }

    public function test_sla_policies_deadlines_and_overdue(): void
    {
        $admin = $this->account('super-administrator');
        $policies = DB::table('sla_policies')->get()->map(fn ($p) => ['priority' => $p->priority, 'response_minutes' => 10, 'resolution_minutes' => 20])->all();
        $this->actingAs($this->employee)->putJson('/api/v1/sla-policies', ['policies' => $policies])->assertForbidden();
        $this->actingAs($admin)->putJson('/api/v1/sla-policies', ['policies' => $policies])->assertOk();
        $policies[0]['resolution_minutes'] = 1;
        $this->putJson('/api/v1/sla-policies', ['policies' => $policies])->assertUnprocessable();
        $t = $this->createTicket();
        $this->travel(11)->minutes();
        $this->getJson('/api/v1/tickets?queue=overdue')->assertJsonPath('meta.total',1);
        $this->getJson('/api/v1/tickets/'.$t['id'])->assertJsonPath('data.sla.response_breached',true)->assertJsonPath('data.sla.resolution_breached',false);
        $this->travelBack();
    }
}
