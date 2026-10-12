<?php

namespace App\Services;

use App\Models\Ticket;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

class TicketAccess
{
    public function query(User $user): Builder
    {
        $query = Ticket::query();
        if (! $user->hasPermission('tickets.view')) {
            return $query->whereRaw('1 = 0');
        }
        if ($user->hasPermission('tickets.view_all')) {
            return $query;
        }

        return $query->where(function ($q) use ($user) {
            $q->where('requester_id', $user->id);
            if ($user->department_id && $user->hasPermission('tickets.view_department')) {
                $q->orWhere('department_id', $user->department_id);
            }
        });
    }

    public function find(User $user, string $id, bool $lock = false): Ticket
    {
        $query = $this->query($user)->whereKey($id);
        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->firstOrFail();
    }

    public function canReply(User $user, Ticket $ticket): bool
    {
        return $ticket->requester_id === $user->id || $user->hasPermission('tickets.reply');
    }

    public function permissions(User $user, Ticket $ticket): array
    {
        return ['update' => $user->hasPermission('tickets.update'), 'assign' => $user->hasPermission('tickets.assign'), 'resolve' => $user->hasPermission('tickets.resolve'), 'notes' => $user->hasPermission('tickets.notes'), 'reply' => $this->canReply($user, $ticket), 'reopen' => $ticket->requester_id === $user->id || $user->hasPermission('tickets.update')];
    }
}
