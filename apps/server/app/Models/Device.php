<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Device extends Model
{
    use HasUuids;

    public function commands()
    {
        return $this->hasMany(DeviceCommand::class);
    }

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['software_inventory_at' => 'datetime', 'software_inventory_complete' => 'boolean', 'health_evaluated_at' => 'datetime', 'last_seen_at' => 'datetime', 'inventory_at' => 'datetime', 'revoked_at' => 'datetime', 'cpu_percent' => 'float', 'ram_available_bytes' => 'integer', 'uptime_seconds' => 'integer', 'network_connected' => 'boolean', 'version' => 'integer'];
    }

    public function department()
    {
        return $this->belongsTo(Department::class);
    }

    public function hardware()
    {
        return $this->hasOne(DeviceHardware::class);
    }

    public function disks()
    {
        return $this->hasMany(DeviceDisk::class);
    }

    public function interfaces()
    {
        return $this->hasMany(DeviceNetworkInterface::class);
    }

    public function credential()
    {
        return $this->hasOne(DeviceCredential::class);
    }

    public function state(): string
    {
        return $this->revoked_at ? 'revoked' : (! $this->last_seen_at ? 'pending' : ($this->last_seen_at->gte(now()->subSeconds(config('deskpilot.offline_seconds'))) ? 'online' : 'offline'));
    }
}
