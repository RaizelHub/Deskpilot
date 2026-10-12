<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TicketHistory extends Model
{
    use HasUuids;

    protected $table = 'ticket_history';

    public $timestamps = false;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['details' => 'array', 'is_internal' => 'boolean', 'created_at' => 'datetime'];
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
