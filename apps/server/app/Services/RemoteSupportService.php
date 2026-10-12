<?php

namespace App\Services;

use App\Models\Device;
use App\Models\RemoteSession;
use App\Models\RemoteSessionEvent;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class RemoteSupportService
{
    public function capabilities(): array
    {
        return ['provider' => 'RustDesk', 'request_workflow' => true, 'live_connections' => false, 'unattended' => false, 'reason' => 'RustDesk connection setup is incomplete. Approval can be recorded, but screen sharing cannot start yet.'];
    }

    public function visible(User $actor, RemoteSession $s): bool
    {
        return $s->customer_id === $actor->id || ($actor->hasPermission('remote.request') && $actor->hasPermission('devices.view') && ($s->technician_id === $actor->id || $actor->hasPermission('devices.manage')));
    }

    private function event(RemoteSession $s, string $action, string $detail, ?User $actor = null): void
    {
        RemoteSessionEvent::create(['remote_session_id' => $s->id, 'actor_id' => $actor?->id, 'action' => $action, 'detail' => $detail, 'created_at' => now()]);
        $audit = app(Audit::class)->record('remote.'.$action, $actor, $s, ['device_id' => $s->device_id, 'detail' => $detail, 'ticket_id' => $s->ticket_id, 'technician_id' => $s->technician_id, 'customer_id' => $s->customer_id, 'requested_mode' => $s->requested_mode, 'approved_mode' => $s->approved_mode]);
        app(AutomationEvents::class)->remote($audit, $s, $action);
    }

    private function finish(RemoteSession $s, string $status, string $reason, ?User $actor = null): void
    {
        $s->update(['status' => $status, 'finished_at' => now(), 'end_reason' => $reason]);
        $this->event($s, $status, $reason, $actor);
    }

    public function reconcile(Device $device): void
    {
        foreach (RemoteSession::where('device_id', $device->id)->whereIn('status', RemoteSession::ACTIVE)->lockForUpdate()->get() as $s) {
            $tech = $s->technician;
            $customer = $s->customer;
            if ($s->expires_at->lte(now())) {
                $this->finish($s, 'expired', 'The request or approval expired. No remote connection was started.');
            } elseif ($device->revoked_at || $device->state() !== 'online') {
                $this->finish($s, 'cancelled', 'The device is no longer online and authorized.');
            } elseif (! $tech?->is_active || ! $tech?->email_verified_at || ! app(TicketAccess::class)->query($tech)->whereKey($s->ticket_id)->exists() || ! $tech->hasPermission('remote.request') || ! $tech->hasPermission('devices.view') || ($s->requested_mode === 'control' && ! $tech->hasPermission('remote.control'))) {
                $this->finish($s, 'cancelled', 'Technician authorization is no longer valid.');
            } elseif (! $customer?->is_active || ! $customer->email_verified_at || $s->ticket->isFinished() || $s->ticket->requester_id !== $customer->id) {
                $this->finish($s, 'cancelled', 'The customer or ticket is no longer eligible.');
            }
        }
    }

    public function sweep(): void
    {
        RemoteSession::whereIn('status', RemoteSession::ACTIVE)->select('device_id')->distinct()->get()->each(function ($s) {
            DB::transaction(function () use ($s) {
                $d = Device::whereKey($s->device_id)->lockForUpdate()->first();
                if ($d) {
                    $this->reconcile($d);
                }
            });
        });
    }

    public function request(User $actor, array $data, ?string $ip): RemoteSession
    {
        return DB::transaction(function () use ($actor, $data, $ip) {
            $device = Device::whereKey($data['device_id'])->lockForUpdate()->firstOrFail();
            $this->reconcile($device);
            $previous = RemoteSession::where('technician_id', $actor->id)->where('request_key', $data['request_key'])->first();
            if ($previous) {
                abort_unless($previous->device_id === $data['device_id'] && $previous->ticket_id === $data['ticket_id'] && $previous->reason === $data['reason'] && $previous->requested_mode === $data['mode'], 409, 'This request key belongs to different request details.');

                return $previous;
            }
            abort_unless($device->state() === 'online', 409, 'Choose an online enrolled device.');
            abort_unless(preg_match('/^\d+\.\d+\.\d+$/', $device->agent_version) && version_compare($device->agent_version, '0.6.0', '>='), 409, 'Upgrade this device to agent 0.6.0 for support notifications.');
            abort_if(RemoteSession::where('device_id', $device->id)->whereIn('status', RemoteSession::ACTIVE)->exists(), 409, 'This device already has a pending support request.');
            abort_if($data['mode'] === 'control' && ! $actor->hasPermission('remote.control'), 403);
            $ticket = app(TicketAccess::class)->find($actor, $data['ticket_id']);
            $customer = $ticket->requester;
            abort_unless(! $ticket->isFinished() && $customer?->is_active && $customer->email_verified_at, 422, 'Choose an open ticket submitted by the customer.');
            abort_if($customer->id === $actor->id, 422, 'The requesting technician cannot also be the approving customer.');
            $s = RemoteSession::create(['status' => 'requested', 'device_id' => $device->id, 'technician_id' => $actor->id, 'customer_id' => $customer->id, 'ticket_id' => $ticket->id, 'requested_mode' => $data['mode'], 'reason' => $data['reason'], 'request_key' => $data['request_key'], 'request_ip' => $ip, 'expires_at' => now()->addMinutes(5)]);
            $this->event($s, 'requested', 'Customer approval requested. Live connections are not configured.', $actor);

            return $s;
        });
    }

    public function action(User $actor, string $id, string $action, ?string $ip): RemoteSession
    {
        abort_unless(in_array($action, ['viewed', 'view', 'control', 'decline', 'cancel'], true), 422);

        return DB::transaction(function () use ($actor, $id, $action, $ip) {
            $s = RemoteSession::findOrFail($id);
            abort_unless($this->visible($actor, $s), 404);
            $device = Device::whereKey($s->device_id)->lockForUpdate()->firstOrFail();
            $this->reconcile($device);
            $s->refresh();
            if ($action === 'cancel') {
                abort_unless($actor->id === $s->customer_id || $actor->id === $s->technician_id || $actor->hasPermission('devices.manage'), 403);
                if ($s->status === 'cancelled') {
                    return $s;
                }abort_unless(in_array($s->status, RemoteSession::ACTIVE, true), 409, 'This request is already finished.');
                $this->finish($s, 'cancelled', 'Support authorization withdrawn. No remote connection was started.', $actor);

                return $s;
            }
            abort_unless($s->customer_id === $actor->id && $s->technician_id !== $actor->id, 403, 'Only the named customer can give consent.');
            if ($action === 'viewed' && in_array($s->status, ['waiting_for_user', 'approved', 'declined'], true)) {
                return $s;
            }
            if ($action === 'decline' && $s->status === 'declined') {
                return $s;
            }
            if (in_array($action, ['view', 'control'], true) && $s->status === 'approved' && $s->approved_mode === $action) {
                return $s;
            }
            abort_unless(in_array($s->status, ['requested', 'waiting_for_user'], true), 409, 'This request is no longer awaiting approval.');
            if ($action === 'viewed') {
                $s->update(['status' => 'waiting_for_user']);
                $this->event($s, 'viewed', 'The named customer opened the request.', $actor);
            } elseif ($action === 'decline') {
                $this->finish($s, 'declined', 'The customer declined remote support.', $actor);
            } else {
                abort_if($action === 'control' && $s->requested_mode !== 'control', 422, 'This request permits view-only consent.');
                $s->update(['status' => 'approved', 'approved_mode' => $action, 'approved_at' => now(), 'consent_ip' => $ip, 'expires_at' => now()->addMinutes(2)]);
                $this->event($s, 'approved', $action === 'view' ? 'Customer approved view only. Sharing has not started.' : 'Customer approved keyboard and mouse. Sharing has not started.', $actor);
            }

            return $s;
        });
    }

    public function poll(Device $device): ?array
    {
        $this->reconcile($device);
        $s = RemoteSession::where('device_id', $device->id)->whereIn('status', ['requested', 'waiting_for_user'])->first();
        if (! $s) {
            return null;
        }
        if (! $s->delivered_at) {
            $s->update(['delivered_at' => now()]);
            $this->event($s, 'agent_received', 'The device agent received the request notification. This does not confirm a visible prompt or customer consent.');
        }

        return ['id' => $s->id, 'expires_at' => $s->expires_at->toIso8601String()];
    }
}
