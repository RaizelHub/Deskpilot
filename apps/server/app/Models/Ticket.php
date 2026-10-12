<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Ticket extends Model
{
    use HasUuids;

    protected $guarded = ['id'];

    public const STATUSES = ['open', 'assigned', 'in_progress', 'waiting_for_user', 'waiting_for_vendor', 'resolved', 'closed'];

    public const PRIORITIES = ['low', 'medium', 'high', 'critical'];

    public const RELATIONS = ['requester:id,name', 'assignee:id,name', 'department:id,name', 'category', 'tags'];

    protected function casts(): array
    {
        return ['version' => 'integer', 'sla_started_at' => 'datetime', 'first_response_due_at' => 'datetime', 'resolution_due_at' => 'datetime', 'first_response_at' => 'datetime', 'resolved_at' => 'datetime', 'closed_at' => 'datetime'];
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requester_id');
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assignee_id');
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(TicketCategory::class, 'category_id');
    }

    public function tags(): BelongsToMany
    {
        return $this->belongsToMany(Tag::class, 'ticket_tag');
    }

    public function comments(): HasMany
    {
        return $this->hasMany(TicketComment::class);
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(TicketAttachment::class);
    }

    public function history(): HasMany
    {
        return $this->hasMany(TicketHistory::class);
    }

    public function isFinished(): bool
    {
        return in_array($this->status, ['resolved', 'closed'], true);
    }

    public function slaState(): array
    {
        return [
            'response_breached' => ($this->first_response_at ?? ($this->resolved_at ?? now()))->gt($this->first_response_due_at),
            'resolution_breached' => ($this->resolved_at ?? now())->gt($this->resolution_due_at),
        ];
    }
}
