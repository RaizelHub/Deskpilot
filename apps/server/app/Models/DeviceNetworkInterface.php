<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class DeviceNetworkInterface extends Model
{
    use HasUuids;

    public $timestamps = false;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['is_up' => 'boolean', 'addresses' => 'array', 'gateways' => 'array', 'dns_servers' => 'array'];
    }
}
