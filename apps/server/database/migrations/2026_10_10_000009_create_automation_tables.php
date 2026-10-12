<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('devices', fn (Blueprint $t) => $t->string('automation_state', 20)->nullable());
        Schema::create('automation_events', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('audit_log_id')->nullable()->constrained()->restrictOnDelete();
            $t->string('event', 60);
            $t->string('target_type', 30);
            $t->uuid('target_id')->nullable();
            $t->text('body');
            $t->timestampTz('created_at');
            $t->unique(['audit_log_id', 'event']);
        });
        Schema::create('webhooks', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('name', 100);
            $t->text('url');
            $t->text('secret');
            $t->boolean('enabled')->default(false);
            $t->unsignedInteger('version')->default(1);
            $t->timestampsTz();
        });
        Schema::create('webhook_subscriptions', function (Blueprint $t) {
            $t->foreignUuid('webhook_id')->constrained()->cascadeOnDelete();
            $t->string('event', 60);
            $t->primary(['webhook_id', 'event']);
        });
        Schema::create('webhook_deliveries', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('webhook_id')->constrained()->restrictOnDelete();
            $t->foreignUuid('automation_event_id')->constrained()->restrictOnDelete();
            $t->unsignedInteger('webhook_version');
            $t->string('status', 20)->default('pending');
            $t->unsignedInteger('attempts')->default(0);
            $t->unsignedInteger('cycle_attempts')->default(0);
            $t->timestampTz('next_attempt_at');
            $t->timestampTz('queued_at')->nullable();
            $t->timestampTz('lease_until')->nullable();
            $t->uuid('lease_token')->nullable();
            $t->timestampTz('completed_at')->nullable();
            $t->string('last_error', 100)->nullable();
            $t->unsignedSmallInteger('response_status')->nullable();
            $t->timestampsTz();
            $t->unique(['webhook_id', 'automation_event_id']);
            $t->index(['status', 'next_attempt_at']);
        });
        Schema::create('webhook_attempts', function (Blueprint $t) {
            $t->bigIncrements('id');
            $t->foreignUuid('webhook_delivery_id')->constrained()->restrictOnDelete();
            $t->unsignedInteger('number');
            $t->string('status', 20);
            $t->timestampTz('started_at');
            $t->timestampTz('finished_at')->nullable();
            $t->unsignedSmallInteger('response_status')->nullable();
            $t->unsignedInteger('duration_ms')->nullable();
            $t->string('error', 100)->nullable();
            $t->unique(['webhook_delivery_id', 'number']);
        });
        Schema::create('notification_rules', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('name', 100);
            $t->string('event', 60);
            $t->string('audience', 40);
            $t->string('priority', 20)->nullable();
            $t->boolean('enabled')->default(true);
            $t->unsignedInteger('version')->default(1);
            $t->timestampsTz();
        });
        Schema::create('app_notifications', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $t->foreignUuid('automation_event_id')->constrained()->restrictOnDelete();
            $t->string('title', 120);
            $t->string('message', 250);
            $t->string('target_type', 30);
            $t->uuid('target_id');
            $t->timestampTz('read_at')->nullable();
            $t->timestampTz('created_at');
            $t->unique(['user_id', 'automation_event_id']);
            $t->index(['user_id', 'read_at', 'created_at']);
        });
        Schema::create('automation_runs', function (Blueprint $t) {
            $t->string('name')->primary();
            $t->timestampTz('last_dispatch_at')->nullable();
            $t->timestampTz('last_worker_at')->nullable();
        });
        DB::table('automation_runs')->insert(['name' => 'webhooks']);
        foreach ([['Assigned tickets', 'ticket.assigned', 'ticket_assignee'], ['Resolved tickets', 'ticket.resolved', 'ticket_requester'], ['Support approval requested', 'remote.requested', 'remote_customer'], ['Support approval received', 'remote.approved', 'remote_technician'], ['Support declined', 'remote.declined', 'remote_technician']] as [$name,$event,$audience]) {
            DB::table('notification_rules')->insert(['id' => (string) Str::uuid(), 'name' => $name, 'event' => $event, 'audience' => $audience, 'enabled' => true, 'version' => 1, 'created_at' => now(), 'updated_at' => now()]);
        }
        foreach (['automation.view', 'automation.manage'] as $name) {
            $id = DB::table('permissions')->where('name', $name)->value('id') ?? (string) Str::uuid();
            DB::table('permissions')->insertOrIgnore(['id' => $id, 'name' => $name, 'created_at' => now(), 'updated_at' => now()]);
            foreach (DB::table('roles')->whereIn('slug', ['super-administrator', 'it-administrator'])->pluck('id') as $role) {
                DB::table('permission_role')->insertOrIgnore(['role_id' => $role, 'permission_id' => $id]);
            }
        }
    }

    public function down(): void
    {
        Schema::table('devices', fn (Blueprint $t) => $t->dropColumn('automation_state'));
        foreach (['app_notifications', 'notification_rules', 'webhook_attempts', 'webhook_deliveries', 'webhook_subscriptions', 'webhooks', 'automation_events', 'automation_runs'] as $t) {
            Schema::dropIfExists($t);
        }DB::table('permissions')->whereIn('name',['automation.view', 'automation.manage'])->delete();
    }
};
