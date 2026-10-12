<?php

namespace App\Services;

use App\Jobs\DeliverWebhook;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class WebhookDeliveryService
{
    public function dispatchDue(): int
    {
        $count = 0;
        WebhookDelivery::whereIn('status', ['pending', 'sending'])->where('next_attempt_at', '<=', now())->where(fn ($q) => $q->whereNull('queued_at')->orWhere('queued_at', '<', now()->subMinutes(3)))->orderBy('created_at')->limit(100)->pluck('id')->each(function ($id) use (&$count) {
            $claimed = DB::transaction(function () use ($id) {
                $d = WebhookDelivery::whereKey($id)->lockForUpdate()->first();
                if (! in_array($d->status, ['pending', 'sending'], true) || $d->next_attempt_at->isFuture() || ($d->queued_at && $d->queued_at->gte(now()->subMinutes(3)))) {
                    return false;
                }$d->update(['queued_at' => now()]);

                return true;
            });
            if ($claimed) {
                try {
                    DeliverWebhook::dispatch($id);
                    $count++;
                } catch (\Throwable $e) {
                    WebhookDelivery::whereKey($id)->update(['queued_at' => null]);
                    throw $e;
                }
            }
        });
        DB::table('automation_runs')->where('name', 'webhooks')->update(['last_dispatch_at' => now()]);

        return $count;
    }

    public function deliver(string $id): void
    {
        $claim = DB::transaction(function () use ($id) {
            $initial = WebhookDelivery::find($id);
            if (! $initial) {
                return null;
            }$hook = Webhook::whereKey($initial->webhook_id)->lockForUpdate()->first();
            $d = WebhookDelivery::whereKey($id)->lockForUpdate()->first();
            if (! in_array($d->status, ['pending', 'sending'], true) || $d->next_attempt_at->isFuture() || ($d->status === 'sending' && $d->lease_until?->isFuture())) {
                return null;
            }
            if (! $hook?->enabled || $hook->version !== $d->webhook_version) {
                $d->update(['status' => 'cancelled', 'completed_at' => now(), 'last_error' => 'configuration_changed']);

                return null;
            }
            if ($d->status === 'sending') {
                $d->attemptsLog()->where('status', 'sending')->update(['status' => 'unknown', 'finished_at' => now(), 'error' => 'worker_lease_expired']);
            }
            if ($d->cycle_attempts >= 5) {
                $d->update(['status' => 'failed', 'completed_at' => now(), 'last_error' => 'attempt_limit']);

                return null;
            }
            $token = (string) Str::uuid();
            $d->update(['status' => 'sending', 'attempts' => $d->attempts + 1, 'cycle_attempts' => $d->cycle_attempts + 1, 'lease_token' => $token, 'lease_until' => now()->addSeconds(120)]);
            $d->attemptsLog()->create(['number' => $d->attempts, 'status' => 'sending', 'started_at' => now()]);
            DB::table('automation_runs')->where('name', 'webhooks')->update(['last_worker_at' => now()]);

            return ['delivery' => $d, 'url' => $hook->url, 'secret' => $hook->secret, 'body' => $d->event->body, 'event' => $d->event->event, 'token' => $token];
        });
        if (! $claim) {
            return;
        }
        $start = microtime(true);
        $timestamp = (string) now()->timestamp;
        $signature = hash_hmac('sha256', $timestamp.'.'.$claim['body'], $claim['secret']);
        $d = $claim['delivery'];
        $terminal = false;
        try {
            $response = app(WebhookTransport::class)->send($claim['url'], $claim['body'], ['Content-Type: application/json', 'User-Agent: DeskPilot-Webhooks/1', 'X-DeskPilot-Delivery: '.$d->id, 'X-DeskPilot-Event: '.$claim['event'], 'X-DeskPilot-Timestamp: '.$timestamp, 'X-DeskPilot-Signature: sha256='.$signature]);
        } catch (\InvalidArgumentException) {
            $response = ['status' => 0, 'error' => 'destination_blocked'];
            $terminal = true;
        } catch (\Throwable) {
            $response = ['status' => 0, 'error' => 'transport_error'];
        }
        $status = $response['status'];
        $success = ! $response['error'] && $status >= 200 && $status < 300;
        $retry = ! $terminal && ($response['error'] || in_array($status, [408, 425, 429], true) || $status >= 500);
        DB::transaction(function () use ($d, $claim, $start, $status, $success, $retry, $response) {
            $row = WebhookDelivery::whereKey($d->id)->lockForUpdate()->first();
            $error = $success ? null : ($response['error'] ?? 'http_'.$status);
            $row->attemptsLog()->where('number', $d->attempts)->where('status', 'sending')->update(['status' => $success ? 'succeeded' : 'failed', 'finished_at' => now(), 'response_status' => $status ?: null, 'duration_ms' => max(0, (int) ((microtime(true) - $start) * 1000)), 'error' => $error]);
            if ($row->status !== 'sending' || $row->lease_token !== $claim['token']) {
                return;
            }
            $again = ! $success && $retry && $row->cycle_attempts < 5;
            $delay = [60, 300, 900, 3600][$row->cycle_attempts - 1] ?? 3600;
            $row->update(['status' => $success ? 'succeeded' : ($again ? 'pending' : 'failed'), 'next_attempt_at' => now()->addSeconds($delay), 'queued_at' => null, 'lease_until' => null, 'lease_token' => null, 'completed_at' => $again ? null : now(), 'last_error' => $error, 'response_status' => $status ?: null]);
        });
    }
}
