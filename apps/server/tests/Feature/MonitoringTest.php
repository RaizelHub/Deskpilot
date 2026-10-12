<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\DeviceAlert;
use App\Models\MonitorState;
use App\Models\Role;
use App\Models\User;
use App\Services\MonitoringService;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class MonitoringTest extends TestCase
{
    use RefreshDatabase;

    private Device $device;

    private User $admin;

    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->admin = User::factory()->create(['is_active' => true]);
        $this->admin->roles()->attach(Role::where('slug', 'super-administrator')->first());
        $this->employee = User::factory()->create(['is_active' => true]);
        $this->employee->roles()->attach(Role::where('slug', 'employee')->first());
        $this->device = Device::create(['name' => 'Monitoring fixture', 'hostname' => 'TEST-PC', 'agent_version' => '0.5.0', 'last_seen_at' => now(), 'inventory_at' => now(), 'cpu_percent' => 10, 'ram_available_bytes' => 500]);
        $this->device->hardware()->create(['ram_total_bytes' => 1000]);
        $this->device->disks()->create(['name' => 'C:', 'total_bytes' => 1000, 'free_bytes' => 500]);
    }

    private function evaluate(): void
    {
        app(MonitoringService::class)->evaluate($this->device->id);
    }

    private function disk(int $free): void
    {
        $this->device->disks()->update(['free_bytes' => $free]);
        $this->device->update(['inventory_at' => now(), 'last_seen_at' => now()]);
        $this->evaluate();
    }

    public function test_storage_incident_is_atomic_deduplicated_and_recovers_without_closing_ticket(): void
    {
        $this->disk(40);
        $this->evaluate();
        $this->assertDatabaseCount('device_alerts', 1);
        $this->assertDatabaseCount('tickets', 1);
        $a = DeviceAlert::first();
        $this->assertSame('critical', $a->severity);
        $t = $a->ticket;
        $this->assertNull($t->requester_id);
        $this->assertSame('high', $t->priority);
        $this->assertNotNull($t->resolution_due_at);
        $this->actingAs($this->admin)->getJson('/api/v1/tickets/'.$t->id)->assertOk()->assertJsonPath('data.requester', null);
        $this->actingAs($this->employee)->getJson('/api/v1/tickets/'.$t->id)->assertNotFound();
        $this->actingAs($this->admin)->postJson('/api/v1/alerts/'.$a->id.'/acknowledge')->assertNoContent();
        $this->postJson('/api/v1/alerts/'.$a->id.'/acknowledge')->assertNoContent();
        $this->assertDatabaseHas('device_alerts', ['status' => 'acknowledged']);
        $this->travel(60)->seconds();
        $this->disk(200);
        $this->assertSame('recovered', $a->fresh()->status);
        $this->assertSame('open', $t->fresh()->status);
        $this->assertDatabaseHas('ticket_history', ['action' => 'monitoring_recovered']);
        $this->postJson('/api/v1/alerts/'.$a->id.'/acknowledge')->assertConflict();
    }

    public function test_cooldown_reuses_incident_then_creates_a_new_episode(): void
    {
        $this->disk(40);
        $a = DeviceAlert::first();
        $this->travel(60)->seconds();
        $this->disk(250);
        $this->travel(60)->seconds();
        $this->disk(40);
        $this->assertDatabaseCount('tickets', 1);
        $this->assertSame(2, $a->fresh()->occurrences);
        $this->assertSame('open', $a->fresh()->status);
        $this->travel(60)->seconds();
        $this->disk(250);
        $this->travel(1801)->seconds();
        $this->disk(40);
        $this->assertDatabaseCount('tickets', 2);
        $this->assertDatabaseCount('device_alerts', 2);
    }

    public function test_sustained_cpu_needs_distinct_contiguous_samples_and_hysteresis(): void
    {
        $this->device->update(['cpu_percent' => 99]);
        $this->evaluate();
        $this->evaluate();
        $this->assertSame(1, MonitorState::where('kind', 'cpu')->first()->samples);
        $this->assertDatabaseCount('device_alerts', 0);
        foreach (range(1, 5) as $i) {
            $this->travel(60)->seconds();
            $this->device->update(['last_seen_at' => now()]);
            $this->evaluate();
        }
        $a = DeviceAlert::where('kind', 'cpu')->firstOrFail();
        $this->assertSame('critical', $a->severity);
        $this->travel(60)->seconds();
        $this->device->update(['last_seen_at' => now(), 'cpu_percent' => 88]);
        $this->evaluate();
        $this->assertSame('open', $a->fresh()->status);
        $this->travel(60)->seconds();
        $this->device->update(['last_seen_at' => now(), 'cpu_percent' => 85]);
        $this->evaluate();
        $this->assertSame('recovered', $a->fresh()->status);
    }

    public function test_missing_stale_and_removed_samples_are_not_healthy_or_recovered(): void
    {
        $this->disk(40);
        $a = DeviceAlert::first();
        $this->device->disks()->delete();
        $this->travel(1300)->seconds();
        $this->device->update(['last_seen_at' => now(), 'cpu_percent' => null]);
        $this->evaluate();
        $this->assertSame('open', $a->fresh()->status);
        $this->device->update(['cpu_percent' => 99]);
        $this->evaluate();
        $this->travel(200)->seconds();
        $this->device->update(['last_seen_at' => now()]);
        $this->evaluate();
        $this->assertSame(1, MonitorState::where('kind', 'cpu')->first()->samples);
        $this->assertSame(0, DeviceAlert::where('kind', 'cpu')->count());
        $this->device->update(['revoked_at' => now()]);
        $this->evaluate();
        $this->assertSame('closed', $a->fresh()->status);
        $this->assertSame('device_revoked', $a->fresh()->close_reason);
        $this->assertSame('unmonitored', app(MonitoringService::class)->health($this->device->fresh())['status']);
    }

    public function test_offline_boundary_pending_exclusion_and_recovery(): void
    {
        $this->travel(180)->seconds();
        $this->evaluate();
        $this->assertSame(0, DeviceAlert::where('kind', 'offline')->count());
        $this->travel(1)->seconds();
        $this->evaluate();
        $this->evaluate();
        $this->assertSame(1, DeviceAlert::where('kind', 'offline')->count());
        $this->device->update(['last_seen_at' => now()]);
        $this->evaluate();
        $this->assertDatabaseHas('device_alerts', ['kind' => 'offline', 'status' => 'recovered']);
        $pending = Device::create(['name' => 'Pending', 'hostname' => 'PENDING', 'agent_version' => '0.5.0']);
        app(MonitoringService::class)->evaluate($pending->id);
        $this->assertSame(0, DeviceAlert::where('device_id', $pending->id)->count());
        $this->assertSame('unknown', app(MonitoringService::class)->health($pending->fresh())['status']);
    }

    public function test_permissions_rule_conflicts_disable_and_no_incident_option(): void
    {
        $this->actingAs($this->employee)->getJson('/api/v1/alerts')->assertForbidden();
        $this->getJson('/api/v1/monitoring-statistics')->assertForbidden();
        $this->getJson('/api/v1/devices/'.$this->device->id.'/health')->assertForbidden();
        $this->actingAs($this->admin);
        $payload = ['enabled' => true, 'auto_incident' => false, 'warning' => 85, 'critical' => 95, 'sustain_seconds' => 0, 'cooldown_seconds' => 1800, 'version' => 1];
        $this->putJson('/api/v1/alert-rules/disk', $payload)->assertOk();
        $this->putJson('/api/v1/alert-rules/disk', $payload)->assertConflict();
        $payload['critical'] = 80;
        $this->putJson('/api/v1/alert-rules/disk', $payload)->assertUnprocessable();
        $this->disk(40);
        $this->assertDatabaseCount('tickets', 0);
        $payload['critical'] = 95;
        $payload['version'] = 2;
        $payload['enabled'] = false;
        $this->putJson('/api/v1/alert-rules/disk', $payload)->assertOk();
        $this->evaluate();
        $this->assertDatabaseHas('device_alerts', ['status' => 'closed', 'close_reason' => 'rule_disabled']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'monitoring.rule_updated']);
        $tech = User::factory()->create(['is_active' => true]);
        $tech->roles()->attach(Role::where('slug', 'it-technician')->first());
        $this->actingAs($tech)->getJson('/api/v1/alerts')->assertOk();
        $this->putJson('/api/v1/alert-rules/disk', $payload)->assertForbidden();
    }

    public function test_scheduler_records_completion_and_fresh_coverage(): void
    {
        $this->artisan('monitoring:evaluate')->assertSuccessful();
        $this->actingAs($this->admin)->getJson('/api/v1/monitoring-statistics')->assertOk()->assertJsonPath('active', 0);
        $this->getJson('/api/v1/devices/'.$this->device->id.'/health')->assertJsonPath('status', 'healthy');
        $this->travel(200)->seconds();
        $this->getJson('/api/v1/devices/'.$this->device->id.'/health')->assertJsonPath('status', 'unknown');
    }

    public function test_memory_measurements_and_incomplete_health_coverage(): void
    {
        $this->device->update(['ram_available_bytes' => 1500]);
        $this->evaluate();
        $this->assertSame('unknown', app(MonitoringService::class)->health($this->device->fresh())['status']);
        $this->device->update(['ram_available_bytes' => 50]);
        foreach (range(0, 5) as $i) {
            $this->travel(60)->seconds();
            $this->device->update(['last_seen_at' => now()]);
            $this->evaluate();
        }
        $this->assertDatabaseHas('device_alerts', ['kind' => 'memory', 'value' => 95, 'severity' => 'warning']);
        $this->device->update(['ram_available_bytes' => null]);
        $this->evaluate();
        $this->assertDatabaseHas('device_alerts', ['kind' => 'memory', 'status' => 'open']);
    }

    public function test_incident_failure_rolls_back_alert_and_sequence(): void
    {
        DB::table('ticket_categories')->where('name', 'Hardware')->delete();
        $this->device->disks()->update(['free_bytes' => 10]);
        try {
            $this->evaluate();
            $this->fail('Missing incident category must fail atomically.');
        } catch (QueryException $e) {
            $this->assertDatabaseCount('device_alerts', 0);
            $this->assertDatabaseCount('tickets', 0);
            $this->assertDatabaseCount('ticket_sequences', 0);
        }
    }
}
