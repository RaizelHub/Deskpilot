<?php

namespace App\Services;

use App\Models\AppNotification;
use App\Models\AuditLog;
use App\Models\AutomationEvent;
use App\Models\Device;
use App\Models\DeviceAlert;
use App\Models\NotificationRule;
use App\Models\RemoteSession;
use App\Models\Ticket;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Support\Str;

class AutomationEvents
{
    public const EVENTS = ['ticket.created', 'ticket.assigned', 'ticket.escalated', 'ticket.resolved', 'device.online', 'device.offline', 'device.warning', 'alert.created', 'alert.escalated', 'alert.recovered', 'remote.requested', 'remote.approved', 'remote.declined', 'remote.cancelled', 'remote.expired'];

    public static function audiences(string $event): array
    {
        return str_starts_with($event, 'ticket.') ? ['ticket_assignee', 'ticket_requester', 'it_team'] : (str_starts_with($event, 'remote.') ? ['remote_customer', 'remote_technician'] : ['it_team']);
    }

    public function ticket(AuditLog $audit, Ticket $ticket, string $action, array $details): void
    {
        $events = [];
        if (in_array($action, ['created', 'monitoring_created'], true)) {
            $events[] = 'ticket.created';
            if ($ticket->assignee_id) {
                $events[] = 'ticket.assigned';
            }
        }
        if ($action === 'updated') {
            $changes = $details['changes'] ?? [];
            if (isset($changes['assignee_id']) && $ticket->assignee_id) {
                $events[] = 'ticket.assigned';
            }if (($changes['status']['to'] ?? null) === 'resolved') {
                $events[] = 'ticket.resolved';
            }$rank = ['low' => 0, 'medium' => 1, 'high' => 2, 'critical' => 3];
            if (isset($changes['priority']) && ($rank[$changes['priority']['to']] ?? 0) > ($rank[$changes['priority']['from']] ?? 0)) {
                $events[] = 'ticket.escalated';
            }
        }
        foreach ($events as $event) {
            $this->emit($event, 'ticket', $ticket->id, ['ticket_id' => $ticket->id, 'number' => $ticket->number, 'priority' => $ticket->priority, 'status' => $ticket->status], $audit, $ticket);
        }
    }

    public function alert(AuditLog $audit, DeviceAlert $alert, string $action): void
    {
        $event = match ($action) {
            'created','recurred' => 'alert.created','escalated' => 'alert.escalated','recovered' => 'alert.recovered',default => null
        };
        if (! $event) {
            return;
        }
        $data = ['alert_id' => $alert->id, 'device_id' => $alert->device_id, 'ticket_id' => $alert->ticket_id, 'kind' => $alert->kind, 'severity' => $alert->severity];
        $this->emit($event, 'alert', $alert->id, $data, $audit, $alert);
        if ($action !== 'recovered' && $alert->kind !== 'offline') {
            $this->emit('device.warning', 'alert', $alert->id, $data, $audit, $alert);
        }
    }

    public function remote(AuditLog $audit, RemoteSession $session, string $action): void
    {
        if (! in_array('remote.'.$action, self::EVENTS, true)) {
            return;
        }$this->emit('remote.'.$action, 'remote', $session->id, ['session_id' => $session->id, 'device_id' => $session->device_id, 'ticket_id' => $session->ticket_id, 'requested_mode' => $session->requested_mode, 'approved_mode' => $session->approved_mode, 'status' => $session->status], $audit, $session);
    }

    public function device(Device $device): void
    {
        $state = $device->state();
        if (! in_array($state, ['online', 'offline'], true) || $device->automation_state === $state) {
            return;
        }$device->update(['automation_state' => $state]);
        $audit = app(Audit::class)->record('device.'.$state, null, $device);
        $this->emit('device.'.$state, 'device', $device->id, ['device_id' => $device->id, 'state' => $state], $audit, $device);
    }

    public function emit(string $name, string $type, ?string $targetId, array $data, ?AuditLog $audit = null, $target = null): AutomationEvent
    {
        if ($audit && ($existing = AutomationEvent::where('audit_log_id', $audit->id)->where('event', $name)->first())) {
            return $existing;
        }
        $e = new AutomationEvent;
        $e->id = (string) Str::uuid();
        $e->fill(['audit_log_id' => $audit?->id, 'event' => $name, 'target_type' => $type, 'target_id' => $targetId, 'created_at' => now()]);
        $e->body = json_encode(['id' => $e->id, 'event' => $name, 'occurred_at' => now()->toIso8601String(), 'data' => $data], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $e->save();
        foreach (Webhook::where('enabled', true)->whereHas('subscriptions', fn ($q) => $q->where('event', $name))->get() as $hook) {
            $this->delivery($hook, $e);
        }
        if ($target) {
            foreach (NotificationRule::where('enabled', true)->where('event', $name)->get() as $rule) {
                if ($rule->priority && $rule->priority !== ($data['priority'] ?? null)) {
                    continue;
                }$this->notify($e, $rule, $target, $data);
            }
        }

        return $e;
    }

    public function delivery(Webhook $hook, AutomationEvent $event): WebhookDelivery
    {
        return WebhookDelivery::firstOrCreate(['webhook_id' => $hook->id, 'automation_event_id' => $event->id], ['webhook_version' => $hook->version, 'status' => 'pending', 'attempts' => 0, 'cycle_attempts' => 0, 'next_attempt_at' => now()]);
    }

    private function notify(AutomationEvent $event, NotificationRule $rule, $target, array $data): void
    {
        $users = User::where('is_active', true)->whereNotNull('email_verified_at');
        $id = match ($rule->audience) {
            'ticket_assignee' => $target->assignee_id,'ticket_requester' => $target->requester_id,'remote_customer' => $target->customer_id,'remote_technician' => $target->technician_id,default => null
        };
        if ($rule->audience === 'it_team') {
            $permission = $event->target_type === 'ticket' ? 'tickets.view_all' : ($event->target_type === 'device' ? 'devices.view' : 'monitoring.view');
            $users->whereHas('roles.permissions', fn ($q) => $q->where('name', $permission));
        } elseif ($id) {
            $users->whereKey($id);
        } else {
            return;
        }
        $users->chunkById(100, function ($users) use ($event, $data) {
            foreach ($users as $user) {
                $title = ucfirst(str_replace(['.', '_'], ' ', $event->event));
                $message = isset($data['number']) ? $data['number'].' · '.$title : $title.'. Open DeskPilot to review.';
                $notification = AppNotification::firstOrCreate(['user_id' => $user->id, 'automation_event_id' => $event->id], ['title' => $title, 'message' => $message, 'target_type' => $event->target_type, 'target_id' => $event->target_id, 'created_at' => now()]);
                if (! app(NotificationAccess::class)->query($user)->whereKey($notification->id)->exists()) {
                    $notification->delete();
                }
            }
        });
    }
}
