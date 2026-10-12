<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tickets', fn (Blueprint $t) => $t->uuid('requester_id')->nullable()->change());
        Schema::table('devices', fn (Blueprint $t) => $t->timestampTz('health_evaluated_at')->nullable());
        Schema::create('alert_rules', function (Blueprint $t) {
            $t->string('kind', 20)->primary();
            $t->boolean('enabled')->default(true);
            $t->unsignedInteger('warning');
            $t->unsignedInteger('critical')->nullable();
            $t->unsignedInteger('sustain_seconds')->default(0);
            $t->unsignedInteger('cooldown_seconds')->default(1800);
            $t->boolean('auto_incident')->default(true);
            $t->unsignedInteger('version')->default(1);
            $t->timestampsTz();
        });
        foreach (['offline' => [180, null, 0], 'disk' => [85, 95, 0], 'cpu' => [90, 98, 300], 'memory' => [90, 98, 300]] as $kind => [$warning,$critical,$sustain]) {
            DB::table('alert_rules')->insert(['kind' => $kind, 'warning' => $kind === 'offline' ? config('deskpilot.offline_seconds', 180) : $warning, 'critical' => $critical, 'sustain_seconds' => $sustain, 'created_at' => now(), 'updated_at' => now()]);
        }
        Schema::create('device_alerts', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('device_id')->constrained()->restrictOnDelete();
            $t->string('kind', 20);
            $t->string('resource', 100)->default('');
            $t->string('severity', 20);
            $t->string('status', 20)->default('open');
            $t->string('summary', 1000);
            $t->double('value')->nullable();
            $t->timestampTz('observed_at')->nullable();
            $t->timestampTz('opened_at');
            $t->timestampTz('recovered_at')->nullable();
            $t->string('close_reason', 80)->nullable();
            $t->foreignUuid('acknowledged_by')->nullable()->constrained('users')->restrictOnDelete();
            $t->timestampTz('acknowledged_at')->nullable();
            $t->foreignUuid('ticket_id')->nullable()->constrained()->restrictOnDelete();
            $t->unsignedInteger('occurrences')->default(1);
            $t->timestampsTz();
            $t->index(['status', 'severity', 'opened_at']);
        });
        DB::statement("CREATE UNIQUE INDEX device_alert_active ON device_alerts (device_id,kind,resource) WHERE status IN ('open','acknowledged')");
        Schema::create('monitor_states', function (Blueprint $t) {
            $t->id();
            $t->foreignUuid('device_id')->constrained()->cascadeOnDelete();
            $t->string('kind', 20);
            $t->string('resource', 100)->default('');
            $t->timestampTz('condition_since')->nullable();
            $t->timestampTz('sample_at')->nullable();
            $t->unsignedInteger('samples')->default(0);
            $t->foreignUuid('alert_id')->nullable()->constrained('device_alerts')->restrictOnDelete();
            $t->unique(['device_id', 'kind', 'resource']);
        });
        Schema::create('monitor_runs', function (Blueprint $t) {
            $t->string('name')->primary();
            $t->timestampTz('completed_at')->nullable();
        });
        DB::table('monitor_runs')->insert(['name' => 'devices']);
    }

    public function down(): void
    {
        Schema::dropIfExists('monitor_runs');
        Schema::dropIfExists('monitor_states');
        Schema::dropIfExists('device_alerts');
        Schema::dropIfExists('alert_rules');
        Schema::table('devices', fn (Blueprint $t) => $t->dropColumn('health_evaluated_at')); /* Keep nullable system-ticket requesters so rollback never destroys incident history. */
    }
};
