<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;

class Audit
{
    public function record(string $action, ?User $actor = null, ?Model $target = null, array $metadata = []): AuditLog
    {
        return AuditLog::create([
            'actor_id' => $actor?->id, 'action' => $action,
            'target_type' => $target ? class_basename($target) : null,
            'target_id' => $target?->getKey(),
            'ip_address' => app()->runningInConsole() ? null : request()->ip(),
            'metadata' => $metadata, 'created_at' => now(),
        ]);
    }
}
