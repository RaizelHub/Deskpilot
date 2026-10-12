<?php

namespace App\Services;

use App\Models\AppNotification;
use App\Models\RemoteSession;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

class NotificationAccess
{
    public function query(User $user): Builder
    {
        return AppNotification::where('user_id', $user->id)->where(function ($q) use ($user) {
            $tickets = app(TicketAccess::class)->query($user)->selectRaw('1')->whereColumn('tickets.id', 'app_notifications.target_id');
            $q->where(fn ($q) => $q->where('target_type', 'ticket')->whereExists($tickets->toBase()));
            if ($user->hasPermission('monitoring.view')) {
                $q->orWhere('target_type', 'alert');
            }
            if ($user->hasPermission('devices.view')) {
                $q->orWhere('target_type', 'device');
            }
            $remote = RemoteSession::selectRaw('1')->whereColumn('remote_sessions.id', 'app_notifications.target_id')->where(function ($r) use ($user) {
                $r->where('customer_id', $user->id);
                if ($user->hasPermission('remote.request') && $user->hasPermission('devices.view')) {
                    if ($user->hasPermission('devices.manage')) {
                        $r->orWhereRaw('1=1');
                    } else {
                        $r->orWhere('technician_id', $user->id);
                    }
                }
            });
            $q->orWhere(fn ($q) => $q->where('target_type', 'remote')->whereExists($remote->toBase()));
        });
    }
}
