<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MonitorState extends Model
{
    public $timestamps = false;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['condition_since' => 'datetime', 'sample_at' => 'datetime', 'samples' => 'integer'];
    }

    public function alert()
    {
        return $this->belongsTo(DeviceAlert::class);
    }
}
