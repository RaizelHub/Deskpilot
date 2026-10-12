<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class RemoteSession extends Model
{
    use HasUuids;

    protected $guarded = ['id'];

    protected $hidden = ['request_key', 'request_ip', 'consent_ip'];

    public const ACTIVE = ['requested', 'waiting_for_user', 'approved'];

    protected function casts(): array
    {
        return ['delivered_at' => 'datetime', 'approved_at' => 'datetime', 'expires_at' => 'datetime', 'finished_at' => 'datetime'];
    }

    public function device()
    {
        return $this->belongsTo(Device::class);
    }

    public function technician()
    {
        return $this->belongsTo(User::class, 'technician_id');
    }

    public function customer()
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    public function ticket()
    {
        return $this->belongsTo(Ticket::class);
    }

    public function events()
    {
        return $this->hasMany(RemoteSessionEvent::class)->orderBy('id');
    }
}
