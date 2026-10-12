<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class DeviceAlert extends Model
{
    use HasUuids;

    protected $guarded = ['id'];

    public const ACTIVE = ['open', 'acknowledged'];

    protected function casts(): array
    {
        return ['opened_at' => 'datetime', 'observed_at' => 'datetime', 'recovered_at' => 'datetime', 'acknowledged_at' => 'datetime', 'value' => 'float', 'occurrences' => 'integer'];
    }

    public function device()
    {
        return $this->belongsTo(Device::class);
    }

    public function ticket()
    {
        return $this->belongsTo(Ticket::class);
    }

    public function acknowledger()
    {
        return $this->belongsTo(User::class, 'acknowledged_by');
    }
}
