<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class DiagnosticTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $employee;

    private Device $device;

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
        $this->key = openssl_pkey_new(['config' => base_path('tests/Fixtures/openssl.cnf'), 'private_key_bits' => 3072]);
        $this->device = $this->makeDevice();
    }

    private function makeDevice(): Device
    {
        $d = Device::create(['name' => 'Diagnostics fixture', 'hostname' => 'TEST-PC', 'agent_version' => '0.4.0', 'last_seen_at' => now()]);
        $public = openssl_pkey_get_details($this->key)['key'];
        $d->credential()->create(['public_key' => $public, 'fingerprint' => hash('sha256', $public)]);

        return $d;
    }

    private function requestCommand(array $extra = [])
    {
        return $this->actingAs($this->admin)->postJson('/api/v1/devices/'.$this->device->id.'/diagnostics', array_merge(['command' => 'network.ip_configuration', 'reason' => 'Investigate reported connectivity problem', 'request_key' => (string) Str::uuid()], $extra));
    }

    private function signed(string $route, array $body = [])
    {
        $path = '/api/v1/agent/'.$route;
        $raw = json_encode($body, JSON_UNESCAPED_SLASHES);
        $time = (string) now()->timestamp;
        $nonce = (string) Str::uuid();
        openssl_sign(implode("\n", ['v1', 'POST', $path, $this->device->id, $time, $nonce, hash('sha256', $raw)]), $signature, $this->key, OPENSSL_ALGO_SHA256);

        return $this->call('POST', $path, [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json', 'HTTP_X_DEVICE_ID' => $this->device->id, 'HTTP_X_AGENT_TIME' => $time, 'HTTP_X_AGENT_NONCE' => $nonce, 'HTTP_X_AGENT_SIGNATURE' => base64_encode($signature)], $raw);
    }

    private function resultPayload(string $lease): array
    {
        return ['lease_id' => $lease, 'status' => 'succeeded', 'summary' => 'Read completed.', 'duration_ms' => 15, 'checks' => [['name' => 'Ethernet', 'status' => 'info', 'detail' => 'Fixture result; not real telemetry.', 'duration_ms' => null]]];
    }

    public function test_roles_online_version_and_allowlist_boundaries(): void
    {
        $url = '/api/v1/devices/'.$this->device->id.'/diagnostics';
        $this->actingAs($this->employee)->getJson($url)->assertForbidden();
        $this->postJson($url, [])->assertForbidden();
        $this->requestCommand(['command' => 'execute_arbitrary_command'])->assertUnprocessable();
        $this->requestCommand(['arguments' => 'cmd /c whoami'])->assertUnprocessable();
        $this->requestCommand(['target' => 'https://arbitrary.example'])->assertUnprocessable();
        $this->device->update(['last_seen_at' => now()->subMinutes(5)]);
        $this->requestCommand()->assertConflict();
        $this->device->update(['last_seen_at' => now(), 'agent_version' => '0.3.0']);
        $this->requestCommand()->assertConflict();
        $this->assertDatabaseCount('device_commands', 0);
    }

    public function test_idempotent_request_claim_and_result_lifecycle(): void
    {
        $key = (string) Str::uuid();
        $c = $this->requestCommand(['request_key' => $key])->assertCreated()->json('data');
        $this->requestCommand(['request_key' => $key])->assertCreated()->assertJsonPath('data.id', $c['id']);
        $this->requestCommand(['request_key' => $key, 'command' => 'system.check_disk'])->assertConflict();
        $this->assertDatabaseCount('device_commands', 1);
        $lease = $this->signed('commands/claim')->assertOk()->json('data');
        $this->signed('commands/claim')->assertJsonPath('data.lease_id', $lease['lease_id']);
        $this->signed('commands/'.$c['id'].'/start', ['lease_id' => $lease['lease_id']])->assertJsonPath('status', 'running');
        $this->signed('commands/claim')->assertJsonPath('data', null);
        $this->signed('commands/'.$c['id'].'/start', ['lease_id' => $lease['lease_id']])->assertConflict();
        $result = $this->resultPayload($lease['lease_id']);
        $this->signed('commands/'.$c['id'].'/result', $result)->assertJsonPath('status', 'succeeded');
        $this->signed('commands/'.$c['id'].'/result', $result)->assertOk();
        $result['summary'] = 'Changed result';
        $this->signed('commands/'.$c['id'].'/result', $result)->assertConflict();
        $this->getJson('/api/v1/devices/'.$this->device->id.'/diagnostics')->assertJsonMissingPath('data.0.lease_id')->assertJsonPath('data.0.requester.id', $this->admin->id);
        $this->assertDatabaseHas('audit_logs', ['action' => 'diagnostic.running']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'diagnostic.succeeded']);
    }

    public function test_queue_expiry_lease_retry_and_running_timeout(): void
    {
        $first = $this->requestCommand()->assertCreated()->json('data.id');
        $this->travel(301)->seconds();
        $this->signed('commands/claim')->assertJsonPath('data', null);
        $this->assertDatabaseHas('device_commands', ['id' => $first, 'status' => 'expired']);
        $this->travelBack();
        $c = $this->requestCommand()->assertCreated()->json('data.id');
        $one = $this->signed('commands/claim')->json('data');
        $this->travel(91)->seconds();
        $two = $this->signed('commands/claim')->assertOk()->json('data');
        $this->assertNotEquals($one['lease_id'], $two['lease_id']);
        $this->assertDatabaseHas('device_commands', ['id' => $c, 'attempts' => 2]);
        $this->signed("commands/$c/start", ['lease_id' => $one['lease_id']])->assertConflict();
        $this->signed("commands/$c/start", ['lease_id' => $two['lease_id']])->assertOk();
        $this->travel(91)->seconds();
        $this->signed("commands/$c/result", $this->resultPayload($two['lease_id']))->assertConflict();
        $this->signed('commands/claim')->assertJsonPath('data', null);
        $this->assertDatabaseHas('device_commands', ['id' => $c, 'status' => 'expired']);
        $this->travelBack();
    }

    public function test_cancel_revoke_and_authorization_recheck(): void
    {
        $c = $this->requestCommand()->json('data.id');
        $lease = $this->signed('commands/claim')->json('data');
        $this->postJson('/api/v1/devices/'.$this->device->id."/diagnostics/$c/cancel")->assertNoContent();
        $this->signed("commands/$c/start", ['lease_id' => $lease['lease_id']])->assertConflict();
        $c = $this->requestCommand()->json('data.id');
        $lease = $this->signed('commands/claim')->json('data');
        $this->admin->update(['is_active' => false]);
        $this->signed("commands/$c/start", ['lease_id' => $lease['lease_id']])->assertJsonPath('status', 'rejected');
        $this->admin->update(['is_active' => true]);
        $c = $this->requestCommand()->json('data.id');
        $lease = $this->signed('commands/claim')->json('data');
        $this->signed("commands/$c/start", ['lease_id' => $lease['lease_id']])->assertOk();
        $this->postJson('/api/v1/devices/'.$this->device->id."/diagnostics/$c/cancel")->assertConflict();
        $this->postJson('/api/v1/devices/'.$this->device->id.'/revoke', ['reason' => 'Retire test identity'])->assertOk();
        $this->assertDatabaseHas('device_commands', ['id' => $c, 'status' => 'rejected']);
        $this->signed("commands/$c/result", $this->resultPayload($lease['lease_id']))->assertUnauthorized();
    }

    public function test_result_validation_and_device_binding(): void
    {
        $c = $this->requestCommand()->json('data.id');
        $lease = $this->signed('commands/claim')->json('data');
        $this->signed("commands/$c/start", ['lease_id' => $lease['lease_id']])->assertOk();
        $result = $this->resultPayload($lease['lease_id']);
        $result['checks'][0]['detail'] = str_repeat('x', 2001);
        $this->signed("commands/$c/result", $result)->assertUnprocessable();
        $this->assertDatabaseHas('device_commands', ['id' => $c, 'status' => 'running', 'result' => null]);
        $this->key = openssl_pkey_new(['config' => base_path('tests/Fixtures/openssl.cnf'), 'private_key_bits' => 3072]);
        $this->device = $this->makeDevice();
        $this->signed("commands/$c/result",$this->resultPayload($lease['lease_id']))->assertNotFound();
    }

    public function test_comprehensive_network_troubleshooting_catalog_and_lifecycle(): void
    {
        // 1. Verify catalog exposes network.comprehensive_troubleshoot
        $catalog = $this->actingAs($this->admin)->getJson('/api/v1/diagnostic-catalog')->assertOk()->json('data');
        $commands = array_column($catalog, 'command');
        $this->assertContains('network.comprehensive_troubleshoot', $commands);

        // 2. Request network.comprehensive_troubleshoot
        $cmd = $this->requestCommand(['command' => 'network.comprehensive_troubleshoot', 'reason' => 'Diagnose offline adapter'])->assertCreated()->json('data');
        $this->assertSame('network.comprehensive_troubleshoot', $cmd['command']);

        // 3. Agent claims and runs command
        $lease = $this->signed('commands/claim')->assertOk()->json('data');
        $this->assertSame('network.comprehensive_troubleshoot', $lease['command']);
        $this->signed('commands/'.$cmd['id'].'/start', ['lease_id' => $lease['lease_id']])->assertJsonPath('status', 'running');

        // 4. Deliver comprehensive result with classification check
        $payload = [
            'lease_id' => $lease['lease_id'],
            'status' => 'succeeded',
            'summary' => 'The approved read-only check completed.',
            'duration_ms' => 42,
            'checks' => [
                ['name' => 'Network Adapter', 'status' => 'pass', 'detail' => 'Primary adapter Ethernet is Up.', 'duration_ms' => 1],
                ['name' => 'IPv4 Configuration', 'status' => 'pass', 'detail' => 'Valid IPv4: 192.168.1.100/255.255.255.0.', 'duration_ms' => 1],
                ['name' => 'Default Gateway', 'status' => 'pass', 'detail' => 'Gateway 192.168.1.1 reachable.', 'duration_ms' => 10],
                ['name' => 'DNS Resolution', 'status' => 'pass', 'detail' => 'www.microsoft.com resolved.', 'duration_ms' => 12],
                ['name' => 'Internet Connectivity', 'status' => 'pass', 'detail' => 'Outbound HTTPS succeeded.', 'duration_ms' => 15],
                ['name' => 'Troubleshooting Classification', 'status' => 'pass', 'detail' => 'HEALTHY: All network layers operating normally.', 'duration_ms' => null],
            ],
        ];
        $this->signed('commands/'.$cmd['id'].'/result', $payload)->assertJsonPath('status', 'succeeded');

        // 5. Verify result retrieved by technician includes classification
        $view = $this->getJson('/api/v1/devices/'.$this->device->id.'/diagnostics')->assertOk()->json('data.0');
        $this->assertSame('network.comprehensive_troubleshoot', $view['command']);
        $this->assertCount(6, $view['result']);
        $this->assertSame('Troubleshooting Classification', $view['result'][5]['name']);
    }
}
