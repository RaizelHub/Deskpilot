<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DeviceHardware extends Model
{
    protected $table = 'device_hardware';

    protected $primaryKey = 'device_id';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['cpu_cores' => 'integer', 'ram_total_bytes' => 'integer', 'boot_time' => 'datetime'];
    }
}
