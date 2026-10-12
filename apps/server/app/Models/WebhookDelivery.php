<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class WebhookDelivery extends Model
{
    use HasUuids;

    protected $guarded = ['id'];

    protected $hidden = ['lease_token'];

    protected function casts(): array
    {
        return ['next_attempt_at' => 'datetime', 'queued_at' => 'datetime', 'lease_until' => 'datetime', 'completed_at' => 'datetime', 'attempts' => 'integer', 'cycle_attempts' => 'integer', 'webhook_version' => 'integer'];
    }

    public function webhook()
    {
        return $this->belongsTo(Webhook::class);
    }

    public function event()
    {
        return $this->belongsTo(AutomationEvent::class, 'automation_event_id');
    }

    public function attemptsLog()
    {
        return $this->hasMany(WebhookAttempt::class);
    }
}
