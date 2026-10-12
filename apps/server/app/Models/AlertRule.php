<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AlertRule extends Model
{
    protected $primaryKey = 'kind';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['enabled' => 'boolean', 'auto_incident' => 'boolean', 'warning' => 'integer', 'critical' => 'integer', 'sustain_seconds' => 'integer', 'cooldown_seconds' => 'integer', 'version' => 'integer'];
    }
}
