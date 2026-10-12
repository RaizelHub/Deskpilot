<?php

namespace App\Services;

use App\Models\Device;
use App\Models\DeviceAlert;
use App\Models\Tag;
use App\Models\Ticket;
use App\Models\TicketComment;
use App\Models\TicketHistory;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class TicketService
{
    public function __construct(private TicketAccess $access, private Audit $audit) {}

    public function create(User $actor, array $data): Ticket
    {
        abort_unless($actor->hasPermission('tickets.create'), 403);

        return DB::transaction(function () use ($actor, $data) {
            $requesterId = $data['requester_id'] ?? $actor->id;
            abort_if($requesterId !== $actor->id && ! $actor->hasPermission('tickets.create_for_others'), 403);
            $requester = User::where('is_active', true)->whereNotNull('email_verified_at')->findOrFail($requesterId);
            if (! empty($data['assignee_id'])) {
                abort_unless($actor->hasPermission('tickets.assign'), 403);
                $this->assignee($data['assignee_id']);
            }
            $year = (int) now()->format('Y');
            DB::table('ticket_sequences')->insertOrIgnore(['year' => $year, 'value' => 0]);
            $sequence = DB::table('ticket_sequences')->where('year', $year)->lockForUpdate()->first();
            $number = $sequence->value + 1;
            DB::table('ticket_sequences')->where('year', $year)->update(['value' => $number]);
            $ticket = new Ticket(collect($data)->only(['title', 'description', 'category_id', 'priority', 'reported_device', 'assignee_id'])->all());
            $ticket->number = sprintf('INC-%d-%06d', $year, $number);
            $ticket->requester_id = $requester->id;
            $ticket->department_id = $requester->department_id;
            $ticket->status = $ticket->assignee_id ? 'assigned' : 'open';
            $ticket->priority ??= 'medium';
            $ticket->version = 1;
            $ticket->sla_started_at = now();
            $this->setDeadlines($ticket);
            $ticket->save();
            $this->tags($ticket, $data['tags'] ?? []);
            $this->history($ticket, $actor, 'created', ['number' => $ticket->number, 'status' => $ticket->status]);

            return $ticket->load(Ticket::RELATIONS);
        });
    }

    public function update(User $actor, string $id, array $data): Ticket
    {
        return DB::transaction(function () use ($actor, $id, $data) {
            $ticket = $this->access->find($actor, $id, true);
            $this->version($ticket, $data['version']);
            abort_unless($actor->hasPermission('tickets.update') || $actor->hasPermission('tickets.assign') || $actor->hasPermission('tickets.resolve'), 403);
            $fields = collect($data)->except(['version', 'tags'])->all();
            if (array_intersect(array_keys($fields), ['title', 'description', 'category_id', 'priority', 'reported_device']) || array_key_exists('tags', $data)) {
                abort_unless($actor->hasPermission('tickets.update'), 403);
            }
            if (array_key_exists('assignee_id', $data)) {
                abort_unless($actor->hasPermission('tickets.assign'), 403);
            }
            $newStatus = $data['status'] ?? $ticket->status;
            if (isset($data['status']) || array_key_exists('resolution_notes', $data)) {
                abort_unless($actor->hasPermission(in_array($newStatus, ['resolved', 'closed'], true) ? 'tickets.resolve' : 'tickets.update'), 403);
            }
            if ($ticket->status === 'closed' || ($ticket->status === 'resolved' && $newStatus !== 'closed')) {
                throw ValidationException::withMessages(['status' => 'Reopen this ticket before editing it.']);
            }
            if (in_array($newStatus, ['resolved', 'closed'], true)) {
                abort_unless($actor->hasPermission('tickets.resolve'), 403);
            }
            $before = $this->snapshot($ticket);
            $oldPriority = $ticket->priority;
            $oldStatus = $ticket->status;
            if (array_key_exists('assignee_id', $data) && $data['assignee_id']) {
                $this->assignee($data['assignee_id']);
            }
            $ticket->fill($fields);
            if (array_key_exists('assignee_id', $data) && ! isset($data['status'])) {
                if ($ticket->assignee_id && $oldStatus === 'open') {
                    $ticket->status = 'assigned';
                }
                if (! $ticket->assignee_id && in_array($oldStatus, ['assigned', 'in_progress', 'waiting_for_user', 'waiting_for_vendor'], true)) {
                    $ticket->status = 'open';
                }
            }
            $this->transition($ticket, $oldStatus);
            if ($ticket->priority !== $oldPriority) {
                $this->setDeadlines($ticket);
            }
            if ($ticket->status === 'resolved' && $oldStatus !== 'resolved') {
                if (mb_strlen(trim((string) $ticket->resolution_notes)) < 3) {
                    throw ValidationException::withMessages(['resolution_notes' => 'Add resolution notes before resolving a ticket.']);
                }
                $ticket->resolved_at = now();
                if (! $ticket->first_response_at && $actor->id !== $ticket->requester_id) {
                    $ticket->first_response_at = now();
                }
            }
            if ($ticket->status === 'closed') {
                $ticket->closed_at = now();
            }
            $ticket->version++;
            $ticket->save();
            if (array_key_exists('tags', $data)) {
                $this->tags($ticket, $data['tags']);
            }
            $after = $this->snapshot($ticket->fresh());
            $changes = [];
            foreach ($after as $field => $value) {
                if (($before[$field] ?? null) !== $value) {
                    $changes[$field] = ['from' => $before[$field] ?? null, 'to' => $value];
                }
            }
            $this->history($ticket, $actor, 'updated', ['changes' => $changes]);

            return $ticket->load(Ticket::RELATIONS);
        });
    }

    public function reopen(User $actor, string $id, int $version, string $reason): Ticket
    {
        return DB::transaction(function () use ($actor, $id, $version, $reason) {
            $ticket = $this->access->find($actor, $id, true);
            abort_unless($actor->id === $ticket->requester_id || $actor->hasPermission('tickets.update'), 403);
            $this->version($ticket, $version);
            if (! $ticket->isFinished()) {
                throw ValidationException::withMessages(['status' => 'Only resolved or closed tickets can be reopened.']);
            }
            $previous = ['reason' => $reason, 'previous_status' => $ticket->status, 'resolution_notes' => $ticket->resolution_notes, 'resolved_at' => $ticket->resolved_at?->toIso8601String(), 'sla' => $ticket->slaState()];
            $ticket->status = 'open';
            if ($ticket->assignee_id && $this->eligibleAssignees()->whereKey($ticket->assignee_id)->exists()) {
                $ticket->status = 'assigned';
            } else {
                $ticket->assignee_id = null;
            }
            $ticket->resolution_notes = null;
            $ticket->resolved_at = null;
            $ticket->closed_at = null;
            $ticket->first_response_at = null;
            $ticket->sla_started_at = now();
            $this->setDeadlines($ticket);
            $ticket->version++;
            $ticket->save();
            $this->history($ticket, $actor, 'reopened', $previous);

            return $ticket->load(Ticket::RELATIONS);
        });
    }

    public function comment(User $actor, string $id, string $body, bool $internal): TicketComment
    {
        return DB::transaction(function () use ($actor, $id, $body, $internal) {
            $ticket = $this->access->find($actor, $id, true);
            abort_unless($internal ? $actor->hasPermission('tickets.notes') : $this->access->canReply($actor, $ticket), 403);
            if ($ticket->status === 'closed') {
                throw ValidationException::withMessages(['body' => 'Reopen this closed ticket before adding a reply.']);
            }
            $comment = $ticket->comments()->create(['author_id' => $actor->id, 'body' => $body, 'is_internal' => $internal]);
            if (! $internal && ! $ticket->isFinished()) {
                if ($actor->id !== $ticket->requester_id && $actor->hasPermission('tickets.reply') && ! $ticket->first_response_at) {
                    $ticket->first_response_at = now();
                }
                if ($actor->id === $ticket->requester_id && $ticket->status === 'waiting_for_user') {
                    $ticket->status = $ticket->assignee_id ? 'in_progress' : 'open';
                    $this->history($ticket, $actor, 'requester_replied', ['status' => $ticket->status]);
                }
            }
            $ticket->version++;
            $ticket->save();
            $this->history($ticket, $actor, $internal ? 'internal_note_added' : 'reply_added', ['comment_id' => $comment->id], $internal);

            return $comment->load('author:id,name');
        });
    }

    public function bulk(User $actor, array $items, array $changes): void
    {
        DB::transaction(function () use ($actor, $items, $changes) {
            $items = collect($items)->sortBy('id');
            foreach ($items as $item) {
                $this->update($actor, $item['id'], $changes + ['version' => $item['version']]);
            }
        });
    }

    public function createMonitoringIncident(Device $device, DeviceAlert $alert): Ticket
    {
        // Internal evaluator only; its device transaction serializes incident creation.
        $year = (int) now()->format('Y');
        DB::table('ticket_sequences')->insertOrIgnore(['year' => $year, 'value' => 0]);
        $sequence = DB::table('ticket_sequences')->where('year', $year)->lockForUpdate()->first();
        $number = $sequence->value + 1;
        DB::table('ticket_sequences')->where('year', $year)->update(['value' => $number]);
        $ticket = new Ticket(['number' => sprintf('INC-%d-%06d', $year, $number), 'title' => mb_substr(ucfirst($alert->kind).' alert · '.$device->name.($alert->resource ? ' · '.$alert->resource : ''), 0, 160), 'description' => "Automatically created by DeskPilot monitoring.\nDevice: {$device->name} ({$device->hostname})\nDevice ID: {$device->id}\nAlert ID: {$alert->id}\n{$alert->summary}\nObserved: ".$alert->observed_at->toIso8601String(), 'requester_id' => null, 'department_id' => $device->department_id, 'category_id' => DB::table('ticket_categories')->where('name', $alert->kind === 'offline' ? 'Network' : 'Hardware')->value('id'), 'reported_device' => $device->hostname, 'priority' => $alert->severity === 'critical' ? 'high' : 'medium', 'status' => 'open', 'version' => 1, 'sla_started_at' => now()]);
        $this->setDeadlines($ticket);
        $ticket->save();
        $this->history($ticket, null, 'monitoring_created', ['alert_id' => $alert->id, 'device_id' => $device->id]);

        return $ticket;
    }

    public function history(Ticket $ticket, ?User $actor, string $action, array $details, bool $internal = false): void
    {
        TicketHistory::create(['ticket_id' => $ticket->id, 'actor_id' => $actor?->id, 'action' => $action, 'is_internal' => $internal, 'details' => $details, 'created_at' => now()]);
        $audit = $this->audit->record('ticket.'.$action, $actor, $ticket, ['number' => $ticket->number]);
        app(AutomationEvents::class)->ticket($audit, $ticket, $action, $details);
    }

    public function eligibleAssignees()
    {
        return User::where('is_active', true)->whereNotNull('email_verified_at')
            ->whereHas('roles.permissions', fn ($q) => $q->where('name', 'tickets.update'))
            ->whereHas('roles.permissions', fn ($q) => $q->where('name', 'tickets.view_all'));
    }

    private function assignee(string $id): void
    {
        if (! $this->eligibleAssignees()->whereKey($id)->exists()) {
            throw ValidationException::withMessages(['assignee_id' => 'Choose an active, verified support team member.']);
        }
    }

    private function version(Ticket $ticket, int $version): void
    {
        abort_if($ticket->version !== $version, 409, 'This ticket changed while you were editing. Refresh the ticket and try again.');
    }

    private function transition(Ticket $ticket, string $from): void
    {
        $allowed = [
            'open' => ['open', 'assigned', 'in_progress', 'waiting_for_user', 'waiting_for_vendor', 'resolved'],
            'assigned' => ['open', 'assigned', 'in_progress', 'waiting_for_user', 'waiting_for_vendor', 'resolved'],
            'in_progress' => ['open', 'assigned', 'in_progress', 'waiting_for_user', 'waiting_for_vendor', 'resolved'],
            'waiting_for_user' => ['open', 'assigned', 'in_progress', 'waiting_for_user', 'waiting_for_vendor', 'resolved'],
            'waiting_for_vendor' => ['open', 'assigned', 'in_progress', 'waiting_for_user', 'waiting_for_vendor', 'resolved'],
            'resolved' => ['closed'], 'closed' => [],
        ];
        if (! in_array($ticket->status, $allowed[$from], true)) {
            throw ValidationException::withMessages(['status' => 'That status transition is not allowed.']);
        }
        if (in_array($ticket->status, ['assigned', 'in_progress', 'waiting_for_user', 'waiting_for_vendor'], true)) {
            if (! $ticket->assignee_id) {
                throw ValidationException::withMessages(['assignee_id' => 'Assign a technician before selecting this status.']);
            }
            $this->assignee($ticket->assignee_id);
        }
    }

    private function setDeadlines(Ticket $ticket): void
    {
        $policy = DB::table('sla_policies')->where('priority', $ticket->priority)->firstOrFail();
        $ticket->first_response_due_at = $ticket->sla_started_at->copy()->addMinutes($policy->response_minutes);
        $ticket->resolution_due_at = $ticket->sla_started_at->copy()->addMinutes($policy->resolution_minutes);
    }

    private function tags(Ticket $ticket, array $names): void
    {
        $names = array_values(array_unique(array_map(fn ($name) => strtolower(trim($name)), $names)));
        foreach ($names as $name) {
            DB::table('tags')->insertOrIgnore(['id' => (string) Str::uuid(), 'name' => $name]);
        }
        $ticket->tags()->sync(Tag::whereIn('name', $names)->pluck('id'));
    }

    private function snapshot(Ticket $ticket): array
    {
        $ticket->load(Ticket::RELATIONS);

        return $ticket->only(['assignee_id', 'title', 'description', 'status', 'priority', 'reported_device', 'resolution_notes']) + ['assignee' => $ticket->assignee?->name, 'category' => $ticket->category->name, 'tags' => $ticket->tags->pluck('name')->sort()->values()->all()];
    }
}
