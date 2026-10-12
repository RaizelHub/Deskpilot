<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('devices', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('name', 100);
            $t->string('hostname', 100);
            $t->foreignUuid('department_id')->nullable()->constrained()->restrictOnDelete();
            $t->string('agent_version', 40);
            $t->timestampTz('last_seen_at')->nullable()->index();
            $t->timestampTz('inventory_at')->nullable();
            $t->timestampTz('revoked_at')->nullable()->index();
            $t->string('revocation_reason', 500)->nullable();
            $t->decimal('cpu_percent', 5, 2)->nullable();
            $t->unsignedBigInteger('ram_available_bytes')->nullable();
            $t->unsignedBigInteger('uptime_seconds')->nullable();
            $t->boolean('network_connected')->nullable();
            $t->unsignedInteger('version')->default(1);
            $t->timestampsTz();
            $t->index(['hostname', 'created_at']);
        });
        Schema::create('device_credentials', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('device_id')->unique()->constrained()->cascadeOnDelete();
            $t->text('public_key');
            $t->string('fingerprint', 64)->unique();
            $t->timestampTz('revoked_at')->nullable();
            $t->timestampsTz();
        });
        Schema::create('enrollment_grants', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('label', 100);
            $t->string('token_hash', 64)->unique();
            $t->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $t->foreignUuid('department_id')->nullable()->constrained()->restrictOnDelete();
            $t->timestampTz('expires_at')->index();
            $t->timestampTz('revoked_at')->nullable();
            $t->timestampTz('used_at')->nullable();
            $t->foreignUuid('device_id')->nullable()->constrained()->restrictOnDelete();
            $t->timestampsTz();
        });
        Schema::create('agent_nonces', function (Blueprint $t) {
            $t->bigIncrements('id');
            $t->foreignUuid('device_id')->constrained()->cascadeOnDelete();
            $t->uuid('nonce');
            $t->timestampTz('created_at')->index();
            $t->unique(['device_id', 'nonce']);
        });
        Schema::create('device_hardware', function (Blueprint $t) {
            $t->foreignUuid('device_id')->primary()->constrained()->cascadeOnDelete();
            foreach (['os_name', 'os_version', 'os_build', 'cpu_name', 'manufacturer', 'model', 'serial_number', 'motherboard', 'gpu'] as $f) {
                $t->string($f, 200)->nullable();
            }$t->unsignedSmallInteger('cpu_cores')->nullable();
            $t->unsignedBigInteger('ram_total_bytes')->nullable();
            $t->timestampTz('boot_time')->nullable();
        });
        Schema::create('device_disks', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('device_id')->constrained()->cascadeOnDelete();
            $t->string('name', 100);
            $t->string('file_system', 40)->nullable();
            $t->unsignedBigInteger('total_bytes');
            $t->unsignedBigInteger('free_bytes');
            $t->unique(['device_id', 'name']);
        });
        Schema::create('device_network_interfaces', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('device_id')->constrained()->cascadeOnDelete();
            $t->string('interface_id', 100);
            $t->string('name', 200);
            $t->string('mac_address', 40)->nullable();
            $t->boolean('is_up');
            $t->jsonb('addresses');
            $t->jsonb('gateways');
            $t->jsonb('dns_servers');
            $t->unique(['device_id', 'interface_id']);
        });
    }

    public function down(): void
    {
        foreach (['device_network_interfaces', 'device_disks', 'device_hardware', 'agent_nonces', 'enrollment_grants', 'device_credentials', 'devices'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
