<?php

namespace App\Services;

use App\Models\Ticket;
use App\Models\User;

class TicketStatistics
{
    public function __construct(private TicketAccess $access) {}

    public function for(User $user): array
    {
        $all = $this->access->query($user);
        $active = (clone $all)->whereNotIn('status', ['resolved', 'closed']);
        $mean = (clone $all)->whereNotNull('resolved_at')->selectRaw('AVG(EXTRACT(EPOCH FROM (resolved_at - sla_started_at)) / 60) AS minutes')->value('minutes');
        $volume = (clone $all)->where('created_at', '>=', now()->startOfDay()->subDays(6))->selectRaw('CAST(created_at AS DATE) AS day, COUNT(*) AS count')->groupByRaw('CAST(created_at AS DATE)')->pluck('count', 'day');
        $days = [];
        for ($i = 6; $i >= 0; $i--) {
            $day = now()->subDays($i)->toDateString();
            $days[] = ['date' => $day, 'count' => (int) ($volume[$day] ?? 0)];
        }

        return [
            'open' => (clone $active)->count(), 'critical' => (clone $active)->where('priority', 'critical')->count(),
            'in_progress' => (clone $active)->where('status', 'in_progress')->count(),
            'resolved_today' => (clone $all)->where('resolved_at', '>=', now()->startOfDay())->count(),
            'unassigned' => (clone $active)->whereNull('assignee_id')->count(),
            'overdue' => (clone $active)->where(fn ($q) => $q->where('resolution_due_at', '<', now())->orWhere(fn ($q) => $q->whereNull('first_response_at')->where('first_response_due_at', '<', now())))->count(),
            'average_resolution_minutes' => $mean === null ? null : round((float) $mean, 1),
            'volume' => $days,
            'by_priority' => (clone $all)->selectRaw('priority, COUNT(*) AS count')->groupBy('priority')->get(),
            'by_category' => (clone $all)->join('ticket_categories', 'ticket_categories.id', '=', 'tickets.category_id')->selectRaw('ticket_categories.name, COUNT(*) AS count')->groupBy('ticket_categories.name')->get(),
            'recent' => (clone $all)->with(Ticket::RELATIONS)->latest('updated_at')->limit(5)->get(),
        ];
    }
}
