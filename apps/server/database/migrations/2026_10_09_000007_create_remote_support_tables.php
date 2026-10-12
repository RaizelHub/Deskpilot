<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('remote_sessions', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('device_id')->constrained()->restrictOnDelete();
            $t->foreignUuid('technician_id')->constrained('users')->restrictOnDelete();
            $t->foreignUuid('customer_id')->constrained('users')->restrictOnDelete();
            $t->foreignUuid('ticket_id')->constrained()->restrictOnDelete();
            $t->uuid('request_key');
            $t->string('requested_mode', 20);
            $t->string('approved_mode', 20)->nullable();
            $t->string('status', 30)->default('requested');
            $t->string('reason', 500);
            $t->string('end_reason', 500)->nullable();
            $t->string('request_ip', 45)->nullable();
            $t->string('consent_ip', 45)->nullable();
            $t->timestampTz('delivered_at')->nullable();
            $t->timestampTz('approved_at')->nullable();
            $t->timestampTz('expires_at');
            $t->timestampTz('finished_at')->nullable();
            $t->timestampsTz();
            $t->unique(['technician_id', 'request_key']);
            $t->index(['customer_id', 'created_at']);
            $t->index(['status', 'expires_at']);
        });
        DB::statement("CREATE UNIQUE INDEX remote_device_pending ON remote_sessions (device_id) WHERE status IN ('requested','waiting_for_user','approved')");
        Schema::create('remote_session_events', function (Blueprint $t) {
            $t->bigIncrements('id');
            $t->foreignUuid('remote_session_id')->constrained()->restrictOnDelete();
            $t->foreignUuid('actor_id')->nullable()->constrained('users')->restrictOnDelete();
            $t->string('action', 50);
            $t->string('detail', 500);
            $t->timestampTz('created_at');
            $t->index(['remote_session_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('remote_session_events');
        Schema::dropIfExists('remote_sessions');
    }
};
