<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('device_commands', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('device_id')->constrained()->restrictOnDelete();
            $t->foreignUuid('requested_by')->constrained('users')->restrictOnDelete();
            $t->foreignUuid('ticket_id')->nullable()->constrained()->restrictOnDelete();
            $t->uuid('request_key');
            $t->string('command', 80);
            $t->string('reason', 500);
            $t->string('request_ip', 45)->nullable();
            $t->string('status', 20)->default('requested');
            $t->unsignedSmallInteger('attempts')->default(0);
            $t->uuid('lease_id')->nullable();
            $t->timestampTz('expires_at')->index();
            $t->timestampTz('lease_expires_at')->nullable();
            $t->timestampTz('accepted_at')->nullable();
            $t->timestampTz('started_at')->nullable();
            $t->timestampTz('finished_at')->nullable();
            $t->unsignedInteger('duration_ms')->nullable();
            $t->string('summary', 1000)->nullable();
            $t->jsonb('result')->nullable();
            $t->timestampsTz();
            $t->unique(['requested_by', 'request_key']);
            $t->index(['device_id', 'status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('device_commands');
    }
};
