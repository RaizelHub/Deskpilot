<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\Device;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class DeviceTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $employee;

    private \OpenSSLAsymmetricKey $key;

    protected function setUp(): void
    {
        parent::setUp();
        config(['deskpilot.agent_allow_loopback_http' => true]);
        $this->seed(RolePermissionSeeder::class);
        $this->admin = User::factory()->create(['is_active' => true]);
        $this->admin->roles()->attach(Role::where('slug', 'super-administrator')->firstOrFail());
        $this->employee = User::factory()->create(['is_active' => true]);
        $this->employee->roles()->attach(Role::where('slug', 'employee')->firstOrFail());
        $this->key = openssl_pkey_new(['config' => base_path('tests/Fixtures/openssl.cnf'), 'private_key_bits' => 3072, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    }

    private function grant(): array
    {
        return $this->actingAs($this->admin)->postJson('/api/v1/enrollment-grants', ['label' => 'Test workstation', 'expires_minutes' => 15])->assertCreated()->assertJsonMissingPath('data.token_hash')->json();
    }

    private function enroll(?array $grant = null)
    {
        $g = $grant ?? $this->grant();

        return $this->postJson('/api/v1/agent/enroll', ['token' => $g['token'], 'hostname' => 'TEST-PC', 'agent_version' => '0.3.0', 'public_key' => openssl_pkey_get_details($this->key)['key']]);
    }

    private function heartbeat(): array
    {
        return ['agent_version' => '0.3.0', 'cpu_percent' => 12.5, 'ram_available_bytes' => 4000000000, 'uptime_seconds' => 500, 'network_connected' => true];
    }

    private function report(string $id, array $body, string $route = 'heartbeat', ?string $nonce = null, ?int $timestamp = null, ?string $signedBody = null)
    {
        $path = '/api/v1/agent/'.$route;
        $raw = json_encode($body, JSON_UNESCAPED_SLASHES);
        $time = (string) ($timestamp ?? now()->timestamp);
        $nonce ??= (string) Str::uuid();
        $canonical = implode("\n", ['v1', 'POST', $path, $id, $time, $nonce, hash('sha256', $signedBody ?? $raw)]);
        openssl_sign($canonical, $signature, $this->key, OPENSSL_ALGO_SHA256);

        return $this->call('POST', $path, [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json', 'HTTP_X_DEVICE_ID' => $id, 'HTTP_X_AGENT_TIME' => $time, 'HTTP_X_AGENT_NONCE' => $nonce, 'HTTP_X_AGENT_SIGNATURE' => base64_encode($signature)], $raw);
    }

    public function test_grant_authorization_expiry_revocation_and_single_use(): void
    {
        $this->actingAs($this->employee)->postJson('/api/v1/enrollment-grants', ['label' => 'Unauthorized', 'expires_minutes' => 15])->assertForbidden();
        $g = $this->grant();
        $id = $this->enroll($g)->assertCreated()->json('device_id');
        $this->enroll($g)->assertOk()->assertJsonPath('device_id', $id);
        $this->assertDatabaseCount('devices', 1);
        $this->key = openssl_pkey_new(['config' => base_path('tests/Fixtures/openssl.cnf'), 'private_key_bits' => 3072]);
        $this->enroll($g)->assertConflict();
        $g = $this->grant();
        $this->deleteJson('/api/v1/enrollment-grants/'.$g['data']['id'])->assertNoContent();
        $this->enroll($g)->assertUnauthorized();
        $g = $this->grant();
        $this->travel(16)->minutes();
        $this->enroll($g)->assertUnauthorized();
        $this->travelBack();
    }

    public function test_signature_binding_replay_and_receipt_time(): void
    {
        $id = $this->enroll()->assertCreated()->json('device_id');
        $nonce = (string) Str::uuid();
        $this->report($id, $this->heartbeat(), nonce: $nonce)->assertOk();
        $this->report($id, $this->heartbeat(), nonce: $nonce)->assertConflict();
        $this->report($id, $this->heartbeat(), signedBody: '{}')->assertUnauthorized();
        $this->report($id, $this->heartbeat(), timestamp: now()->subMinutes(6)->timestamp)->assertUnauthorized();
        $this->report((string) Str::uuid(), $this->heartbeat())->assertUnauthorized();
        $this->assertNotNull(Device::find($id)->last_seen_at);
        $this->assertDatabaseCount('agent_nonces', 1);
        $this->getJson('/api/v1/devices/'.$id)->assertOk()->assertJsonPath('data.state', 'online')->assertJsonMissingPath('data.credential');
        $this->travel(181)->seconds();
        $this->getJson('/api/v1/devices/'.$id)->assertJsonPath('data.state', 'offline');
        $this->travelBack();
    }

    public function test_revoked_identity_cannot_report_and_employees_cannot_read_devices(): void
    {
        $id = $this->enroll()->assertCreated()->json('device_id');
        $this->getJson('/api/v1/device-statistics')->assertJsonPath('pending', 1);
        $this->postJson('/api/v1/devices/'.$id.'/revoke', ['reason' => 'Device retired'])->assertOk();
        $this->report($id, $this->heartbeat())->assertUnauthorized();
        $this->getJson('/api/v1/devices/'.$id)->assertJsonPath('data.state', 'revoked');
        $this->actingAs($this->employee)->getJson('/api/v1/devices')->assertForbidden();
        $this->getJson('/api/v1/devices/'.$id)->assertForbidden();
        $this->getJson('/api/v1/enrollment-grants')->assertForbidden();
    }

    public function test_inventory_is_normalized_and_invalid_report_does_not_replace_it(): void
    {
        $id = $this->enroll()->assertCreated()->json('device_id');
        $hardware = array_fill_keys(['os_name', 'os_version', 'os_build', 'cpu_name', 'cpu_cores', 'ram_total_bytes', 'manufacturer', 'model', 'serial_number', 'motherboard', 'gpu', 'boot_time'], null);
        $hardware['os_name'] = 'Windows test fixture';
        $payload = ['hostname' => 'TEST-PC', 'hardware' => $hardware, 'disks' => [['name' => 'C:\\', 'file_system' => 'NTFS', 'total_bytes' => 1000, 'free_bytes' => 500]], 'interfaces' => [['interface_id' => 'test', 'name' => 'Ethernet', 'mac_address' => null, 'is_up' => true, 'addresses' => ['192.0.2.10'], 'gateways' => ['192.0.2.1'], 'dns_servers' => ['192.0.2.2']]]];
        $this->report($id, $payload, 'inventory')->assertOk();
        $this->getJson('/api/v1/devices/'.$id)->assertJsonPath('data.hardware.os_name', 'Windows test fixture')->assertJsonCount(1, 'data.disks');
        $payload['disks'][0]['free_bytes'] = 2000;
        $this->report($id, $payload, 'inventory')->assertUnprocessable();
        $this->assertDatabaseHas('device_disks', ['device_id' => $id, 'free_bytes' => 500]);
        $this->report($id, array_merge($this->heartbeat(), ['cpu_percent' => 120]))->assertUnprocessable();
    }

    public function test_transport_and_device_credentials_do_not_grant_browser_access(): void
    {
        $g = $this->grant();
        config(['deskpilot.agent_allow_loopback_http' => false]);
        $this->enroll($g)->assertForbidden();
        config(['deskpilot.agent_allow_loopback_http' => true]);
        $id = $this->enroll($g)->assertCreated()->json('device_id');
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/devices', ['X-Device-Id' => $id])->assertUnauthorized();
    }

    public function test_device_edit_conflicts_and_department_references_are_preserved(): void
    {
        $department = Department::create(['name' => 'Device operations']);
        $id = $this->enroll()->assertCreated()->json('device_id');
        $this->patchJson('/api/v1/devices/'.$id, ['name' => 'Renamed computer', 'department_id' => $department->id, 'version' => 1])->assertOk()->assertJsonPath('data.version', 2);
        $this->patchJson('/api/v1/devices/'.$id, ['name' => 'Stale overwrite', 'version' => 1])->assertConflict();
        $this->getJson('/api/v1/devices?search=Renamed&state=pending')->assertJsonPath('meta.total', 1);
        $this->deleteJson('/api/v1/departments/'.$department->id)->assertUnprocessable();
        $this->assertDatabaseHas('departments', ['id' => $department->id]);
    }
}
