<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\InstalledSoftware;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class SoftwareInventoryTest extends TestCase
{
    use RefreshDatabase;

    private Device $device;

    private \OpenSSLAsymmetricKey $key;

    private User $tech;

    private array $application;

    protected function setUp(): void
    {
        parent::setUp();
        config(['deskpilot.agent_allow_loopback_http' => true]);
        $this->seed(RolePermissionSeeder::class);
        $this->tech = User::factory()->create(['is_active' => true]);
        $this->tech->roles()->attach(Role::where('slug', 'it-technician')->first());
        $this->key = openssl_pkey_new(['config' => base_path('tests/Fixtures/openssl.cnf'), 'private_key_bits' => 3072]);
        $public = openssl_pkey_get_details($this->key)['key'];
        $this->device = Device::create(['name' => 'Software fixture', 'hostname' => 'SW-PC', 'agent_version' => '0.7.0', 'last_seen_at' => now()]);
        $this->device->credential()->create(['public_key' => $public, 'fingerprint' => hash('sha256', $public)]);
        $this->application = ['source_key' => hash('sha256', 'fixture'), 'name' => 'Example application', 'version' => '1.0', 'publisher' => 'Example publisher', 'installed_on' => '2026-01-01'];
    }

    private function report(array $body, ?string $nonce = null, ?string $deviceId = null)
    {
        $path = '/api/v1/agent/software-inventory';
        $raw = json_encode($body, JSON_UNESCAPED_SLASHES);
        $time = (string) now()->timestamp;
        $nonce ??= (string) Str::uuid();
        $id = $deviceId ?? $this->device->id;
        openssl_sign(implode("\n", ['v1', 'POST', $path, $id, $time, $nonce, hash('sha256', $raw)]), $signature, $this->key, OPENSSL_ALGO_SHA256);

        return $this->call('POST', $path, [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json', 'HTTP_X_DEVICE_ID' => $id, 'HTTP_X_AGENT_TIME' => $time, 'HTTP_X_AGENT_NONCE' => $nonce, 'HTTP_X_AGENT_SIGNATURE' => base64_encode($signature)], $raw);
    }

    public function test_signed_reports_update_versions_and_preserve_partial_observations(): void
    {
        $this->report(['complete' => true, 'applications' => [$this->application]])->assertOk();
        $first = InstalledSoftware::first();
        $this->travel(1)->hours();
        $this->report(['complete' => false, 'applications' => []])->assertOk();
        $this->assertNull($first->fresh()->removed_at);
        $this->assertFalse($this->device->fresh()->software_inventory_complete);
        $this->report(['complete' => true, 'applications' => [[...$this->application, 'version' => '2.0']]])->assertOk();
        $this->assertDatabaseCount('installed_software', 1);
        $this->assertSame('2.0', $first->fresh()->version);
        $this->assertTrue($first->fresh()->first_detected_at->eq($first->first_detected_at));
        $this->report(['complete' => true, 'applications' => []])->assertOk();
        $this->assertNotNull($first->fresh()->removed_at);
        $this->report(['complete' => true, 'applications' => [$this->application]])->assertOk();
        $this->assertNull($first->fresh()->removed_at);
        $this->assertDatabaseCount('installed_software', 1);
    }

    public function test_validation_is_atomic_replay_and_revocation_rejected(): void
    {
        $body = ['complete' => true, 'applications' => [$this->application]];
        $nonce = (string) Str::uuid();
        $this->report($body, $nonce)->assertOk();
        $this->report($body, $nonce)->assertConflict();
        $this->report(['complete' => true, 'applications' => [$this->application, $this->application]])->assertUnprocessable();
        $this->report(['complete' => true, 'applications' => [[...$this->application, 'name' => 'Changed'], ['source_key' => 'invalid']]])->assertUnprocessable();
        $this->assertSame('Example application', InstalledSoftware::first()->name);
        $this->report(['complete' => true, 'applications' => [[...$this->application, 'uninstall_command' => 'bad']]])->assertUnprocessable();
        $this->report([...$body, 'device_id' => (string) Str::uuid()])->assertUnprocessable();
        $other = Device::create(['name' => 'Other', 'hostname' => 'OTHER', 'agent_version' => '0.7.0']);
        $this->report($body, deviceId: $other->id)->assertUnauthorized();
        $this->device->update(['revoked_at' => now()]);
        $this->report($body)->assertUnauthorized();
        $this->assertDatabaseCount('installed_software', 1);
    }

    public function test_inventory_search_sort_coverage_privacy_and_permissions(): void
    {
        $this->report(['complete' => true, 'applications' => [$this->application]])->assertOk();
        $this->actingAs($this->tech)->getJson('/api/v1/software-inventory?search=application&publisher=example&sort=version&direction=desc')->assertOk()->assertJsonPath('total', 1)->assertJsonMissingPath('data.0.source_key')->assertJsonMissingPath('data.0.device.credential');
        $this->getJson('/api/v1/software-coverage')->assertJsonPath('fresh_complete', 1);
        $this->travel(9)->hours();
        $this->getJson('/api/v1/software-coverage')->assertJsonPath('fresh_complete', 0);
        $employee = User::factory()->create(['is_active' => true]);
        $employee->roles()->attach(Role::where('slug', 'employee')->first());
        $this->actingAs($employee)->getJson('/api/v1/software-inventory')->assertForbidden();
        $this->getJson('/api/v1/software-coverage')->assertForbidden();
    }
}
