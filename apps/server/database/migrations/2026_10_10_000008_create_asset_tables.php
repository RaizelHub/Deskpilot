<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('assets', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('tag', 40)->unique();
            $t->string('name', 160);
            $t->string('category', 30);
            $t->string('manufacturer', 120)->nullable();
            $t->string('model', 160)->nullable();
            $t->string('serial_number', 160)->nullable();
            $t->date('purchased_on')->nullable();
            $t->date('warranty_expires_on')->nullable();
            $t->foreignUuid('department_id')->nullable()->constrained()->restrictOnDelete();
            $t->foreignUuid('device_id')->nullable()->unique()->constrained()->restrictOnDelete();
            $t->string('location', 160)->nullable();
            $t->string('status', 20)->default('available');
            $t->text('notes')->nullable();
            $t->unsignedInteger('version')->default(1);
            $t->timestampsTz();
            $t->index(['status', 'category']);
            $t->index('warranty_expires_on');
        });
        DB::statement("ALTER TABLE assets ADD CONSTRAINT assets_status_check CHECK (status IN ('available','in_use','repair','retired','lost','disposed'))");
        DB::statement('ALTER TABLE assets ADD CONSTRAINT assets_warranty_dates_check CHECK (purchased_on IS NULL OR warranty_expires_on IS NULL OR warranty_expires_on >= purchased_on)');
        Schema::create('asset_assignments', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('asset_id')->constrained()->restrictOnDelete();
            $t->foreignUuid('user_id')->constrained()->restrictOnDelete();
            $t->foreignUuid('assigned_by')->constrained('users')->restrictOnDelete();
            $t->foreignUuid('returned_by')->nullable()->constrained('users')->restrictOnDelete();
            $t->timestampTz('assigned_at');
            $t->timestampTz('returned_at')->nullable();
            $t->string('notes', 1000);
            $t->string('return_notes', 1000)->nullable();
            $t->index(['asset_id', 'assigned_at']);
            $t->index(['user_id', 'returned_at']);
        });
        DB::statement('CREATE UNIQUE INDEX asset_one_active_assignment ON asset_assignments (asset_id) WHERE returned_at IS NULL');
        Schema::create('asset_events', function (Blueprint $t) {
            $t->bigIncrements('id');
            $t->foreignUuid('asset_id')->constrained()->restrictOnDelete();
            $t->foreignUuid('actor_id')->constrained('users')->restrictOnDelete();
            $t->string('action', 40);
            $t->string('detail', 1000);
            $t->timestampTz('created_at');
            $t->index(['asset_id', 'created_at']);
        });
        Schema::table('devices', function (Blueprint $t) {
            $t->timestampTz('software_inventory_at')->nullable();
            $t->boolean('software_inventory_complete')->nullable();
        });
        Schema::create('installed_software', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('device_id')->constrained()->restrictOnDelete();
            $t->string('source_key', 64);
            $t->string('name', 200);
            $t->string('version', 100)->nullable();
            $t->string('publisher', 160)->nullable();
            $t->date('installed_on')->nullable();
            $t->timestampTz('first_detected_at');
            $t->timestampTz('last_detected_at');
            $t->timestampTz('removed_at')->nullable();
            $t->unique(['device_id', 'source_key']);
            $t->index(['device_id', 'removed_at']);
            $t->index('name');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('installed_software');
        Schema::table('devices', fn (Blueprint $t) => $t->dropColumn(['software_inventory_at', 'software_inventory_complete']));
        Schema::dropIfExists('asset_events');
        Schema::dropIfExists('asset_assignments');
        Schema::dropIfExists('assets');
    }
};
