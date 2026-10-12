<?php

namespace App\Services;

use App\Models\AlertRule;
use App\Models\Device;
use App\Models\DeviceAlert;
use App\Models\MonitorState;
use App\Models\Ticket;
use Illuminate\Support\Facades\DB;

class MonitoringService
{
    public function sweep(): void
    {
        Device::select('id')->chunkById(100, function ($devices) {
            foreach ($devices as $device) {
                $this->evaluate($device->id);
            }
        });
        DB::table('monitor_runs')->where('name', 'devices')->update(['completed_at' => now()]);
    }

    public function evaluate(string $id): void
    {
        DB::transaction(function () use ($id) {
            $d = Device::whereKey($id)->lockForUpdate()->firstOrFail();
            $d->load(['hardware', 'disks']);
            app(AutomationEvents::class)->device($d);
            foreach (AlertRule::all() as $rule) {
                if (! $rule->enabled || $d->revoked_at) {
                    $this->closeKind($d, $rule->kind, $d->revoked_at ? 'device_revoked' : 'rule_disabled');

                    continue;
                }
                if ($rule->kind === 'offline') {
                    $seconds = $d->last_seen_at ? max(0, now()->timestamp - $d->last_seen_at->timestamp) : null;
                    $this->sample($d, $rule, '', $seconds, now(), $seconds !== null, $seconds !== null && $seconds > $rule->warning);

                    continue;
                }
                $online = $d->state() === 'online';
                if ($rule->kind === 'disk') {
                    $fresh = $online && $d->inventory_at && $d->inventory_at->gte(now()->subMinutes(20));
                    $names = [];
                    foreach ($d->disks as $disk) {
                        $names[] = $disk->name;
                        $value = $disk->total_bytes > 0 ? 100 * (1 - $disk->free_bytes / $disk->total_bytes) : null;
                        $this->sample($d, $rule, $disk->name, $value, $d->inventory_at, $fresh && $value !== null);
                    }
                    // A missing drive or stale snapshot is unknown, never proof of recovery.
                    foreach (MonitorState::where('device_id', $d->id)->where('kind', 'disk')->whereNotIn('resource', $names)->get() as $state) {
                        $state->update(['condition_since' => null, 'samples' => 0]);
                    }
                } else {
                    $value = $rule->kind === 'cpu' ? $d->cpu_percent : ($d->hardware?->ram_total_bytes > 0 && $d->ram_available_bytes !== null && $d->ram_available_bytes <= $d->hardware->ram_total_bytes ? 100 * (1 - $d->ram_available_bytes / $d->hardware->ram_total_bytes) : null);
                    $this->sample($d, $rule, '', $value, $d->last_seen_at, $online && $value !== null);
                }
            }
            $d->health_evaluated_at = now();
            $d->save();
        });
    }

    private function sample(Device $d, AlertRule $rule, string $resource, ?float $value, $at, bool $fresh, ?bool $breach = null): void
    {
        $s = MonitorState::firstOrCreate(['device_id' => $d->id, 'kind' => $rule->kind, 'resource' => $resource]);
        $alert = $s->alert;
        if (! $fresh) {
            $s->update(['condition_since' => null, 'samples' => 0]);

            return;
        }
        $active = $alert && in_array($alert->status, DeviceAlert::ACTIVE, true);
        $breach ??= $value > $rule->warning;
        $recover = $rule->kind === 'offline' ? ! $breach : $value <= max(0, $rule->warning - 5);
        if ($active && $recover) {
            $this->close($alert, 'recovered');
            $s->update(['condition_since' => null, 'samples' => 0, 'sample_at' => $at]);

            return;
        }
        if (! $breach && ! $active) {
            $s->update(['condition_since' => null, 'samples' => 0, 'sample_at' => $at]);

            return;
        }
        $newSample = ! $s->sample_at || $at->gt($s->sample_at);
        if (! $newSample) {
            return;
        }
        if (! $s->condition_since || ($s->sample_at && $at->timestamp - $s->sample_at->timestamp > ($rule->kind === 'disk' ? 1200 : config('deskpilot.offline_seconds')))) {
            $s->condition_since = $at;
            $s->samples = 0;
        }
        $s->sample_at = $at;
        $s->samples++;
        $s->save();
        if (! $active && ($at->timestamp - $s->condition_since->timestamp < $rule->sustain_seconds || ($rule->sustain_seconds > 0 && $s->samples < 3))) {
            return;
        }
        $severity = $rule->critical !== null && $value > $rule->critical ? 'critical' : 'warning';
        $summary = $rule->kind === 'offline' ? 'No heartbeat for '.(int) $value.' seconds.' : ucfirst($rule->kind).($resource ? " ($resource)" : '').' usage is '.round($value, 1)."%. Warning above {$rule->warning}%".($rule->critical !== null ? ", critical above {$rule->critical}%." : '.');
        if (! $active) {
            if ($alert && $alert->close_reason === 'recovered' && $alert->recovered_at->gt(now()->subSeconds($rule->cooldown_seconds))) {
                $alert->fill(['status' => 'open', 'recovered_at' => null, 'close_reason' => null, 'acknowledged_at' => null, 'acknowledged_by' => null, 'occurrences' => $alert->occurrences + 1]);
                $event = 'recurred';
            } else {
                $alert = new DeviceAlert(['device_id' => $d->id, 'kind' => $rule->kind, 'resource' => $resource, 'status' => 'open', 'opened_at' => now()]);
                $event = 'created';
            }
        } else {
            $event = $alert->severity !== 'critical' && $severity === 'critical' ? 'escalated' : null;
        }
        $alert->fill(['severity' => $active && $alert->severity === 'critical' ? 'critical' : $severity, 'summary' => $summary, 'value' => $value, 'observed_at' => $at]);
        $alert->save();
        $s->update(['alert_id' => $alert->id]);
        if ($rule->auto_incident && ! $alert->ticket_id) {
            $ticket = app(TicketService::class)->createMonitoringIncident($d, $alert);
            $alert->ticket_id = $ticket->id;
            $alert->save();
        }
        if ($event) {
            $audit = app(Audit::class)->record('alert.'.$event, null, $alert, ['device_id' => $d->id, 'kind' => $rule->kind]);
            app(AutomationEvents::class)->alert($audit, $alert, $event);
        }
    }

    private function close(DeviceAlert $alert, string $reason): void
    {
        $alert->update(['status' => $reason === 'recovered' ? 'recovered' : 'closed', 'recovered_at' => now(), 'close_reason' => $reason]);
        $audit = app(Audit::class)->record('alert.'.$reason, null, $alert);
        app(AutomationEvents::class)->alert($audit, $alert, $reason);
        if ($alert->ticket_id) {
            $ticket = Ticket::find($alert->ticket_id);
            app(TicketService::class)->history($ticket, null, 'monitoring_'.$reason, ['alert_id' => $alert->id, 'message' => 'Monitoring condition ended; ticket resolution remains a technician decision.'], true);
        }
    }

    private function closeKind(Device $d, string $kind, string $reason): void
    {
        foreach (DeviceAlert::where('device_id', $d->id)->where('kind', $kind)->whereIn('status', DeviceAlert::ACTIVE)->get() as $a) {
            $this->close($a, $reason);
        }
        MonitorState::where('device_id', $d->id)->where('kind', $kind)->update(['condition_since' => null, 'samples' => 0]);
    }

    public function health(Device $d): array
    {
        $active = DeviceAlert::where('device_id', $d->id)->whereIn('status', DeviceAlert::ACTIVE)->get();
        $fresh = $d->state() === 'online' && $d->inventory_at?->gte(now()->subMinutes(20)) && $d->health_evaluated_at && $d->health_evaluated_at->gte(now()->subMinutes(3));
        $complete = $d->cpu_percent !== null && $d->ram_available_bytes !== null && $d->hardware?->ram_total_bytes > 0 && $d->ram_available_bytes <= $d->hardware->ram_total_bytes && $d->disks()->where('total_bytes', '>', 0)->exists() && ! $d->disks()->where('total_bytes', '<=', 0)->exists();
        $pending = MonitorState::where('device_id', $d->id)->whereNotNull('condition_since')->exists();

        return ['status' => $d->revoked_at ? 'unmonitored' : ($active->contains('severity', 'critical') ? 'critical' : ($active->isNotEmpty() || ($fresh && $pending) ? 'warning' : ($fresh && $complete && AlertRule::where('enabled', true)->count() === 4 ? 'healthy' : 'unknown'))), 'evaluated_at' => $d->health_evaluated_at, 'inventory_at' => $d->inventory_at, 'active_alerts' => $active->count()];
    }
}
