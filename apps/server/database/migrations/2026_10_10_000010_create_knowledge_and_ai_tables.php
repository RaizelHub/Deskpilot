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
        Schema::create('knowledge_categories', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('name', 80)->unique();
        });
        foreach (['Networking', 'Windows', 'Hardware', 'Software', 'Printer', 'Accounts', 'Microsoft 365', 'Security', 'VPN', 'Common Problems'] as $name) {
            DB::table('knowledge_categories')->insert(['id' => (string) Str::uuid(), 'name' => $name]);
        }
        Schema::create('knowledge_articles', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('category_id')->constrained('knowledge_categories')->restrictOnDelete();
            $t->foreignUuid('author_id')->constrained('users')->restrictOnDelete();
            $t->string('title', 160);
            $t->string('summary', 400);
            $t->text('body');
            $t->string('visibility', 20)->default('staff');
            $t->string('status', 20)->default('draft');
            $t->unsignedInteger('version')->default(1);
            $t->timestampsTz();
            $t->index(['status', 'visibility', 'category_id']);
        });
        DB::statement("CREATE INDEX knowledge_search ON knowledge_articles USING GIN (to_tsvector('simple', title || ' ' || summary || ' ' || body))");
        Schema::create('knowledge_article_tags', function (Blueprint $t) {
            $t->foreignUuid('article_id')->constrained('knowledge_articles')->cascadeOnDelete();
            $t->string('name', 40);
            $t->primary(['article_id', 'name']);
            $t->index('name');
        });
        Schema::create('ai_runs', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('ticket_id')->constrained()->restrictOnDelete();
            $t->foreignUuid('requested_by')->constrained('users')->restrictOnDelete();
            $t->foreignUuid('diagnostic_id')->nullable()->constrained('device_commands')->restrictOnDelete();
            $t->uuid('request_key');
            $t->string('provider', 20);
            $t->string('model', 120);
            $t->string('status', 20)->default('queued');
            $t->string('context_hash', 64);
            $t->unsignedInteger('ticket_version');
            $t->text('result')->nullable();
            $t->string('error_code', 50)->nullable();
            $t->timestampTz('started_at')->nullable();
            $t->timestampTz('finished_at')->nullable();
            $t->timestampsTz();
            $t->unique(['requested_by', 'request_key']);
            $t->index(['ticket_id', 'requested_by', 'created_at']);
            $t->index(['status', 'created_at']);
        });
        DB::statement("CREATE UNIQUE INDEX ai_one_active_per_user_ticket ON ai_runs(ticket_id,requested_by) WHERE status IN ('queued','running')");
        Schema::create('ai_run_sources', function (Blueprint $t) {
            $t->foreignUuid('run_id')->constrained('ai_runs')->cascadeOnDelete();
            $t->foreignUuid('article_id')->constrained('knowledge_articles')->restrictOnDelete();
            $t->unsignedInteger('version');
            $t->primary(['run_id', 'article_id']);
        });
        Schema::create('ai_usage_days', function (Blueprint $t) {
            $t->date('day')->primary();
            $t->unsignedInteger('requests')->default(0);
        });
        foreach (['knowledge.view', 'knowledge.staff', 'knowledge.manage', 'ai.use'] as $name) {
            $id = (string) Str::uuid();
            DB::table('permissions')->insert(['id' => $id, 'name' => $name, 'created_at' => now(), 'updated_at' => now()]);
            $slugs = $name === 'knowledge.view' ? ['super-administrator', 'it-administrator', 'it-technician', 'helpdesk-agent', 'department-manager', 'employee'] : ($name === 'knowledge.manage' ? ['super-administrator', 'it-administrator'] : ['super-administrator', 'it-administrator', 'it-technician', 'helpdesk-agent']);
            foreach (DB::table('roles')->whereIn('slug', $slugs)->pluck('id') as $role) {
                DB::table('permission_role')->insertOrIgnore(['role_id' => $role, 'permission_id' => $id]);
            }
        }
    }

    public function down(): void
    {
        foreach (['ai_run_sources', 'ai_runs', 'ai_usage_days', 'knowledge_article_tags', 'knowledge_articles', 'knowledge_categories'] as $t) {
            Schema::dropIfExists($t);
        }DB::table('permissions')->whereIn('name', ['knowledge.view', 'knowledge.staff', 'knowledge.manage', 'ai.use'])->delete();
    }
};
