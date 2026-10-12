<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class DeviceCommand extends Model
{
    use HasUuids;

    protected $guarded = ['id'];

    protected $hidden = ['lease_id', 'request_key'];

    public const ACTIVE = ['requested', 'accepted', 'running'];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'lease_expires_at' => 'datetime', 'accepted_at' => 'datetime', 'started_at' => 'datetime', 'finished_at' => 'datetime', 'attempts' => 'integer', 'duration_ms' => 'integer', 'result' => 'array'];
    }

    public function requester()
    {
        return $this->belongsTo(User::class, 'requested_by');
    }

    public function ticket()
    {
        return $this->belongsTo(Ticket::class);
    }
}
