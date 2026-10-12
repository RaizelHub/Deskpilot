<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\AssetAssignment;
use App\Models\Department;
use App\Models\Device;
use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use App\Services\AssetService;
use App\Services\Audit;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AssetTest extends TestCase
{
    use RefreshDatabase;

    public function test_assignment_and_history_roll_back_when_auditing_fails(): void
    {
        $asset = $this->createAsset();
        $this->mock(Audit::class, function ($mock) {
            $mock->shouldReceive('record')->once()->andThrow(new \RuntimeException('Audit unavailable'));
        });
        try {
            app(AssetService::class)->assign($this->admin, $asset['id'], ['version' => 1, 'user_id' => $this->employee->id, 'notes' => 'Test atomic handover']);
            $this->fail('Expected audit failure.');
        } catch (\RuntimeException $error) {
            $this->assertSame('Audit unavailable', $error->getMessage());
        }
        $this->assertDatabaseCount('asset_assignments', 0);
        $this->assertDatabaseCount('asset_events', 1);
        $this->assertDatabaseHas('assets', ['id' => $asset['id'], 'version' => 1, 'status' => 'available']);
    }

    public function test_asset_manager_without_device_permission_cannot_link_or_read_software(): void
    {
        $role = Role::create(['name' => 'Asset custodian', 'slug' => 'asset-custodian']);
        $role->permissions()->attach(Permission::whereIn('name', ['assets.view', 'assets.manage'])->pluck('id'));
        $user = User::factory()->create(['is_active' => true]);
        $user->roles()->attach($role);
        $this->actingAs($user)->postJson('/api/v1/assets', $this->payload)->assertCreated();
        $device = Device::create(['name' => 'Restricted device', 'hostname' => 'PC', 'agent_version' => '0.7.0']);
        $this->postJson('/api/v1/assets', [...$this->payload, 'tag' => 'NEW-TAG', 'device_id' => $device->id])->assertForbidden();
        $this->getJson('/api/v1/asset-options')->assertJsonPath('devices', []);
        $this->getJson('/api/v1/software-inventory')->assertForbidden();
    }

    private User $admin;

    private User $tech;

    private User $employee;

    private array $payload;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->admin = $this->account('it-administrator');
        $this->tech = $this->account('it-technician');
        $this->employee = $this->account('employee');
        $this->payload = ['tag' => 'it-lap-001', 'name' => 'Accounting laptop', 'category' => 'laptop', 'manufacturer' => 'ACME', 'model' => 'Workstation', 'serial_number' => 'SERIAL-001', 'purchased_on' => today()->subYear()->toDateString(), 'warranty_expires_on' => today()->addDays(30)->toDateString(), 'department_id' => null, 'device_id' => null, 'location' => 'Office 2', 'status' => 'available', 'notes' => 'Purchased for office use.'];
    }

    private function account(string $slug): User
    {
        $u = User::factory()->create(['is_active' => true]);
        $u->roles()->attach(Role::where('slug', $slug)->firstOrFail());

        return $u;
    }

    private function createAsset(): array
    {
        return $this->actingAs($this->admin)->postJson('/api/v1/assets', $this->payload)->assertCreated()->json('data');
    }

    public function test_asset_creation_warranty_filters_and_role_boundaries(): void
    {
        $a = $this->createAsset();
        $this->assertSame('IT-LAP-001', $a['tag']);
        $this->assertSame('expiring', $a['warranty_state']);
        $this->getJson('/api/v1/assets?warranty=expiring&search=serial')->assertJsonPath('total', 1);
        $this->getJson('/api/v1/asset-statistics')->assertJsonPath('warranty_expiring', 1);
        $this->actingAs($this->tech)->getJson('/api/v1/assets/'.$a['id'])->assertOk();
        $this->postJson('/api/v1/assets', $this->payload)->assertForbidden();
        $this->getJson('/api/v1/asset-options')->assertForbidden();
        $this->actingAs($this->employee)->getJson('/api/v1/assets')->assertForbidden();
        $this->getJson('/api/v1/assets/'.$a['id'].'/assignments')->assertForbidden();
        $this->getJson('/api/v1/assets/'.$a['id'].'/history')->assertForbidden();
    }

    public function test_duplicate_tag_stale_edits_and_invalid_dates(): void
    {
        $a = $this->createAsset();
        $this->postJson('/api/v1/assets', [...$this->payload, 'tag' => 'IT-LAP-001'])->assertUnprocessable();
        $this->patchJson('/api/v1/assets/'.$a['id'], [...$this->payload, 'version' => 1, 'name' => 'Updated laptop'])->assertOk()->assertJsonPath('data.version', 2);
        $this->patchJson('/api/v1/assets/'.$a['id'], [...$this->payload, 'version' => 1])->assertConflict();
        $this->patchJson('/api/v1/assets/'.$a['id'], [...$this->payload, 'version' => 2, 'warranty_expires_on' => today()->subYears(2)->toDateString()])->assertUnprocessable();
        $this->patchJson('/api/v1/assets/'.$a['id'], [...$this->payload, 'version' => 2, 'status' => 'in_use'])->assertUnprocessable();
        $this->assertDatabaseCount('asset_events', 2);
        $this->assertDatabaseCount('assets', 1);
    }

    public function test_assign_reassign_return_preserves_history_and_guards_stale_changes(): void
    {
        $a = $this->createAsset();
        $url = '/api/v1/assets/'.$a['id'];
        $this->postJson($url.'/assign', ['version' => 1, 'user_id' => $this->employee->id, 'notes' => 'New starter handover'])->assertOk()->assertJsonPath('data.status', 'in_use')->assertJsonPath('data.current_assignment.user.id', $this->employee->id);
        $this->postJson($url.'/assign', ['version' => 1, 'user_id' => $this->tech->id, 'notes' => 'Stale handover'])->assertConflict();
        $this->patchJson($url, [...$this->payload, 'version' => 2, 'status' => 'retired'])->assertUnprocessable();
        $this->postJson($url.'/assign', ['version' => 2, 'user_id' => $this->tech->id, 'notes' => 'Transfer to IT'])->assertOk()->assertJsonPath('data.version', 3);
        $this->assertSame(1, AssetAssignment::whereNull('returned_at')->count());
        $this->assertDatabaseCount('asset_assignments', 2);
        $this->postJson($url.'/return', ['version' => 3, 'status' => 'repair', 'notes' => 'Replace damaged keyboard'])->assertOk()->assertJsonPath('data.status', 'repair')->assertJsonPath('data.current_assignment', null);
        $this->getJson($url.'/assignments')->assertJsonPath('total', 2)->assertJsonPath('data.0.return_notes', 'Replace damaged keyboard');
        $this->getJson($url.'/history')->assertJsonPath('total', 4);
        $this->postJson($url.'/assign', ['version' => 4, 'user_id' => $this->employee->id, 'notes' => 'Unavailable equipment'])->assertUnprocessable();
        $this->postJson($url.'/return', ['version' => 4, 'status' => 'available', 'notes' => 'Already returned'])->assertConflict();
    }

    public function test_inactive_assignee_device_uniqueness_and_department_retention(): void
    {
        $d = Device::create(['name' => 'Windows device', 'hostname' => 'PC', 'agent_version' => '0.7.0']);
        $department = Department::create(['name' => 'Asset storage']);
        $this->payload['device_id'] = $d->id;
        $this->payload['department_id'] = $department->id;
        $a = $this->createAsset();
        $this->postJson('/api/v1/assets', [...$this->payload, 'tag' => 'IT-LAP-002'])->assertConflict();
        $this->employee->update(['is_active' => false]);
        $this->postJson('/api/v1/assets/'.$a['id'].'/assign', ['version' => 1, 'user_id' => $this->employee->id, 'notes' => 'Invalid assignment'])->assertUnprocessable();
        $this->deleteJson('/api/v1/departments/'.$department->id)->assertUnprocessable();
        $this->assertDatabaseCount('asset_assignments', 0);
        $d->update(['revoked_at' => now()]);
        $this->postJson('/api/v1/assets', [...$this->payload, 'tag' => 'IT-LAP-003'])->assertUnprocessable();
    }

    public function test_warranty_boundaries_unknown_and_retired_summary(): void
    {
        $this->createAsset();
        $asset = Asset::first();
        $asset->update(['warranty_expires_on' => today()]);
        $this->getJson('/api/v1/assets?warranty=expiring')->assertJsonPath('total', 1);
        $asset->update(['warranty_expires_on' => today()->subDay()]);
        $this->getJson('/api/v1/assets?warranty=expired')->assertJsonPath('data.0.warranty_state', 'expired');
        $asset->update(['warranty_expires_on' => today()->addDays(31)]);
        $this->getJson('/api/v1/assets?warranty=covered')->assertJsonPath('total', 1);
        $asset->update(['warranty_expires_on' => null]);
        $this->getJson('/api/v1/assets?warranty=unknown')->assertJsonPath('total', 1);
        $asset->update(['warranty_expires_on' => today(), 'status' => 'retired']);
        $this->getJson('/api/v1/asset-statistics')->assertJsonPath('warranty_expiring', 0);
    }
}
