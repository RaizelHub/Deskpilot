<?php

namespace App\Services;

use App\Models\Device;
use App\Models\DeviceCommand;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class DiagnosticService
{
    public const CATALOG = [
        'network.ping_gateway' => ['name' => 'Ping gateway', 'description' => 'Two ICMP probes to each detected gateway (up to four). Reports latency and packet loss.'],
        'network.test_internet' => ['name' => 'Internet test', 'description' => 'HTTPS HEAD to https://www.microsoft.com. Tests connectivity to this endpoint, not the whole Internet.'],
        'network.test_dns' => ['name' => 'DNS test', 'description' => 'Resolve www.microsoft.com using the device’s configured DNS resolver.'],
        'network.ip_configuration' => ['name' => 'IP configuration', 'description' => 'Read active adapter addresses, gateways, DNS and link state.'],
        'network.dhcp_information' => ['name' => 'DHCP information', 'description' => 'Read Windows DHCP mode, server and lease information; no release or renew.'],
        'network.traceroute' => ['name' => 'Traceroute', 'description' => 'Trace up to 12 IPv4 hops to 1.1.1.1. Firewalls may hide hops.'],
        'system.check_disk' => ['name' => 'Disk check', 'description' => 'Read fixed-disk accessibility, free space and Windows disk status. No repairs or filesystem integrity scan.'],
    ];

    public function __construct(private Audit $audit) {}

    private function transition(DeviceCommand $c, string $status, string $summary, ?User $actor = null): void
    {
        $c->status = $status;
        $c->summary = $summary;
        if (! in_array($status, DeviceCommand::ACTIVE, true)) {
            $c->finished_at = now();
        }$c->save();
        $this->audit->record('diagnostic.'.$status, $actor, $c, ['device_id' => $c->device_id, 'command' => $c->command]);
    }

    public function expire(Device $device): void
    {
        foreach (DeviceCommand::where('device_id', $device->id)->whereIn('status', DeviceCommand::ACTIVE)->lockForUpdate()->get() as $c) {
            if ($c->status === 'requested' && $c->expires_at->lte(now())) {
                $this->transition($c, 'expired', 'The agent did not accept this request before its deadline.');
            } elseif (in_array($c->status, ['accepted', 'running'], true) && $c->lease_expires_at->lte(now())) {
                if ($c->status === 'accepted' && $c->attempts < 2 && $c->expires_at->isFuture()) {
                    $c->lease_id = null;
                    $c->lease_expires_at = null;
                    $this->transition($c, 'requested', 'Delivery lease elapsed. One delivery retry is available.');
                } else {
                    $this->transition($c, 'expired', $c->status === 'running' ? 'No result arrived before the execution lease expired. Completion is unknown.' : 'Delivery attempts expired.');
                }
            }
        }
    }

    public function sweep(): void
    {
        Device::whereHas('commands', fn ($q) => $q->whereIn('status', DeviceCommand::ACTIVE))->select('id')->chunkById(100, function ($devices) {
            foreach ($devices as $d) {
                DB::transaction(function () use ($d) {
                    $device = Device::whereKey($d->id)->lockForUpdate()->first();
                    if ($device) {
                        $this->expire($device);
                    }
                });
            }
        });
    }

    private function authorized(DeviceCommand $c): bool
    {
        $actor = User::find($c->requested_by);

        return $actor && $actor->email_verified_at && $actor->hasPermission('devices.view') && $actor->hasPermission('devices.diagnostics');
    }

    public function request(User $actor, string $id, array $d, ?string $ip): DeviceCommand
    {
        return DB::transaction(function () use ($actor, $id, $d, $ip) {
            $device = Device::whereKey($id)->lockForUpdate()->firstOrFail();
            $existing = DeviceCommand::where('requested_by', $actor->id)->where('request_key', $d['request_key'])->first();
            if ($existing) {
                abort_unless($existing->device_id === $id && $existing->command === $d['command'] && $existing->reason === $d['reason'] && $existing->ticket_id === ($d['ticket_id'] ?? null), 409, 'This request key already belongs to a different request.');

                return $existing;
            }
            abort_unless($device->state() === 'online', 409, 'Diagnostics require an online, enrolled device.');
            abort_unless(preg_match('/^\d+\.\d+\.\d+$/', $device->agent_version) && version_compare($device->agent_version, '0.4.0', '>='), 409, 'Update this Windows agent to 0.4.0 or later.');
            if ($d['ticket_id'] ?? null) {
                app(TicketAccess::class)->find($actor, $d['ticket_id']);
            }$this->expire($device);
            abort_if(DeviceCommand::where('device_id', $id)->whereIn('status', DeviceCommand::ACTIVE)->count() >= 10, 429, 'This device already has ten pending diagnostics.');
            $c = DeviceCommand::create(['device_id' => $id, 'requested_by' => $actor->id, 'ticket_id' => $d['ticket_id'] ?? null, 'request_key' => $d['request_key'], 'command' => $d['command'], 'reason' => $d['reason'], 'request_ip' => $ip, 'expires_at' => now()->addMinutes(5)]);
            $this->transition($c, 'requested', 'Waiting for the agent to accept this check.', $actor);

            return $c;
        });
    }

    public function claim(Device $device): ?array
    {
        $this->expire($device);
        if (DeviceCommand::where('device_id', $device->id)->where('status', 'running')->exists()) {
            return null;
        }
        foreach (DeviceCommand::where('device_id', $device->id)->whereIn('status', ['requested', 'accepted'])->orderBy('created_at')->orderBy('id')->lockForUpdate()->get() as $c) {
            if (! $this->authorized($c) || ! array_key_exists($c->command, self::CATALOG)) {
                $this->transition($c, 'rejected', 'Requester authorization or command approval is no longer valid.');

                continue;
            }
            if ($c->status === 'requested') {
                $c->lease_id = (string) Str::uuid();
                $c->lease_expires_at = now()->addSeconds(90);
                $c->accepted_at = now();
                $c->attempts++;
                $this->transition($c, 'accepted', 'Accepted by the device agent.');
            }

            return ['id' => $c->id, 'command' => $c->command, 'lease_id' => $c->lease_id, 'lease_expires_at' => $c->lease_expires_at->toIso8601String(), 'timeout_seconds' => 30];
        }

return null;
    }

    public function start(Device $device, string $id, string $lease): DeviceCommand
    {
        $this->expire($device);
        $c = DeviceCommand::where('device_id', $device->id)->whereKey($id)->lockForUpdate()->firstOrFail();
        abort_unless($c->status === 'accepted' && $c->lease_id === $lease, 409, 'Command is no longer awaiting execution on this lease.');
        if (! $this->authorized($c)) {
            $this->transition($c, 'rejected', 'Requester authorization was revoked.');

            return $c;
        }
        $c->started_at = now();
        $c->lease_expires_at = now()->addSeconds(90);
        $this->transition($c, 'running', 'The agent is running this read-only check.');

        return $c;
    }

    public function result(Device $device, string $id, array $d): DeviceCommand
    {
        $this->expire($device);
        $c = DeviceCommand::where('device_id', $device->id)->whereKey($id)->lockForUpdate()->firstOrFail();
        abort_unless($c->lease_id === $d['lease_id'], 409, 'Stale execution lease.');
        if (in_array($c->status, ['succeeded', 'failed', 'rejected'], true) && $c->result !== null) {
            abort_unless($c->status === $d['status'] && $c->summary === $d['summary'] && $c->duration_ms === $d['duration_ms'] && $c->result == $d['checks'], 409, 'This command already has a different result.');

            return $c;
        }
        abort_unless($c->status === 'running', 409, 'This execution lease is no longer active.');
        abort_if(strlen(json_encode($d)) > 65536, 422, 'Diagnostic result exceeds 64 KiB.');
        $c->duration_ms = $d['duration_ms'];
        $c->result = $d['checks'];
        $this->transition($c, $d['status'], $d['summary']);

        return $c;
    }

    public function cancel(User $actor, string $deviceId, string $id): void
    {
        DB::transaction(function () use ($actor, $deviceId, $id) {
            $device = Device::whereKey($deviceId)->lockForUpdate()->firstOrFail();
            $this->expire($device);
            $c = DeviceCommand::where('device_id', $deviceId)->whereKey($id)->lockForUpdate()->firstOrFail();
            abort_unless(in_array($c->status, ['requested', 'accepted'], true), 409, 'Only queued checks can be cancelled. Running work cannot be remotely stopped.');
            $this->transition($c,'cancelled','Cancelled before execution.',$actor);
        });
    }

    public function revoke(Device $device,User $actor): void
    {
        foreach (DeviceCommand::where('device_id',$device->id)->whereIn('status',DeviceCommand::ACTIVE)->lockForUpdate()->get() as $c) {
            $this->transition($c,'rejected','Device identity was revoked. A running local read may finish, but its result will not be accepted.',$actor);
        }
    }
}
