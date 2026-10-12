<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Asset extends Model
{
    use HasUuids;

    protected $guarded = ['id'];

    public const CATEGORIES = ['desktop', 'laptop', 'monitor', 'printer', 'router', 'switch', 'access_point', 'server', 'ups', 'mobile_device', 'other'];

    public const STATUSES = ['available', 'in_use', 'repair', 'retired', 'lost', 'disposed'];

    public const RELATIONS = ['department:id,name', 'device:id,name,hostname', 'currentAssignment.user:id,name'];

    protected function casts(): array
    {
        return ['purchased_on' => 'date:Y-m-d', 'warranty_expires_on' => 'date:Y-m-d', 'version' => 'integer'];
    }

    public function department()
    {
        return $this->belongsTo(Department::class);
    }

    public function device()
    {
        return $this->belongsTo(Device::class);
    }

    public function currentAssignment()
    {
        return $this->hasOne(AssetAssignment::class)->whereNull('returned_at');
    }

    public function assignments()
    {
        return $this->hasMany(AssetAssignment::class);
    }

    public function events()
    {
        return $this->hasMany(AssetEvent::class);
    }

    protected $appends = ['warranty_state'];

    public function getWarrantyStateAttribute(): string
    {
        if (! $this->warranty_expires_on) {
            return 'unknown';
        }
        if ($this->warranty_expires_on->lt(today())) {
            return 'expired';
        }

        return $this->warranty_expires_on->lte(today()->addDays(30)) ? 'expiring' : 'covered';
    }
}
