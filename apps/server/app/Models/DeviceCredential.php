<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class DeviceCredential extends Model
{
    use HasUuids;

    protected $guarded = ['id'];

    protected $hidden = ['public_key'];

    protected function casts(): array
    {
        return ['revoked_at' => 'datetime'];
    }
}
