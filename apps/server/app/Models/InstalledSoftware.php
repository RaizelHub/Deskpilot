<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class InstalledSoftware extends Model
{
    use HasUuids;

    protected $table = 'installed_software';

    public $timestamps = false;

    protected $guarded = ['id'];

    protected $hidden = ['source_key'];

    protected function casts(): array
    {
        return ['installed_on' => 'date:Y-m-d', 'first_detected_at' => 'datetime', 'last_detected_at' => 'datetime', 'removed_at' => 'datetime'];
    }

    public function device()
    {
        return $this->belongsTo(Device::class);
    }
}
