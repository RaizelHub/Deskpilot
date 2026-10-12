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
        Schema::create('ticket_categories', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('name', 60)->unique();
        });
        foreach (['Network', 'Internet', 'Wi-Fi', 'Computer', 'Hardware', 'Software', 'Printer', 'Email', 'Account', 'VPN', 'Microsoft 365', 'Security', 'Other'] as $name) {
            DB::table('ticket_categories')->insert(['id' => (string) Str::uuid(), 'name' => $name]);
        }
        Schema::create('sla_policies', function (Blueprint $t) {
            $t->string('priority', 20)->primary();
            $t->unsignedInteger('response_minutes');
            $t->unsignedInteger('resolution_minutes');
            $t->timestampsTz();
        });
        foreach (['critical' => [15, 240], 'high' => [60, 480], 'medium' => [240, 1440], 'low' => [480, 2880]] as $priority => [$response, $resolution]) {
            DB::table('sla_policies')->insert(['priority' => $priority, 'response_minutes' => $response, 'resolution_minutes' => $resolution, 'created_at' => now(), 'updated_at' => now()]);
        }
        Schema::create('ticket_sequences', function (Blueprint $t) {
            $t->unsignedInteger('year')->primary();
            $t->unsignedBigInteger('value')->default(0);
        });
        Schema::create('tickets', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('number', 30)->unique();
            $t->string('title', 160);
            $t->text('description');
            $t->foreignUuid('requester_id')->constrained('users')->restrictOnDelete();
            $t->foreignUuid('assignee_id')->nullable()->constrained('users')->restrictOnDelete();
            $t->foreignUuid('department_id')->nullable()->constrained()->restrictOnDelete();
            $t->foreignUuid('category_id')->constrained('ticket_categories')->restrictOnDelete();
            $t->string('reported_device', 100)->nullable();
            $t->enum('priority', ['low', 'medium', 'high', 'critical'])->default('medium');
            $t->enum('status', ['open', 'assigned', 'in_progress', 'waiting_for_user', 'waiting_for_vendor', 'resolved', 'closed'])->default('open');
            $t->text('resolution_notes')->nullable();
            $t->unsignedInteger('version')->default(1);
            $t->timestampTz('sla_started_at');
            $t->timestampTz('first_response_due_at');
            $t->timestampTz('resolution_due_at');
            $t->timestampTz('first_response_at')->nullable();
            $t->timestampTz('resolved_at')->nullable();
            $t->timestampTz('closed_at')->nullable();
            $t->timestampsTz();
            $t->index(['requester_id', 'created_at']);
            $t->index(['assignee_id', 'status']);
            $t->index(['status', 'priority']);
            $t->index(['department_id', 'status']);
            $t->index('created_at');
            $t->index('resolution_due_at');
        });
        Schema::create('tags', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('name', 30)->unique();
        });
        Schema::create('ticket_tag', function (Blueprint $t) {
            $t->foreignUuid('ticket_id')->constrained()->cascadeOnDelete();
            $t->foreignUuid('tag_id')->constrained()->cascadeOnDelete();
            $t->primary(['ticket_id', 'tag_id']);
        });
        Schema::create('ticket_comments', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('ticket_id')->constrained()->cascadeOnDelete();
            $t->foreignUuid('author_id')->constrained('users')->restrictOnDelete();
            $t->text('body');
            $t->boolean('is_internal')->default(false);
            $t->timestampsTz();
            $t->index(['ticket_id', 'created_at']);
        });
        Schema::create('ticket_attachments', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('ticket_id')->constrained()->cascadeOnDelete();
            $t->foreignUuid('uploader_id')->constrained('users')->restrictOnDelete();
            $t->string('filename', 180);
            $t->string('storage_path');
            $t->string('mime_type', 100);
            $t->unsignedInteger('size');
            $t->boolean('is_internal')->default(false);
            $t->timestampsTz();
            $t->index(['ticket_id', 'created_at']);
        });
        Schema::create('ticket_history', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('ticket_id')->constrained()->cascadeOnDelete();
            $t->foreignUuid('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $t->string('action', 60);
            $t->boolean('is_internal')->default(false);
            $t->jsonb('details')->nullable();
            $t->timestampTz('created_at');
            $t->index(['ticket_id', 'created_at']);
        });
    }

    public function down(): void
    {
        foreach (['ticket_history', 'ticket_attachments', 'ticket_comments', 'ticket_tag', 'tags', 'tickets', 'ticket_sequences', 'sla_policies', 'ticket_categories'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
