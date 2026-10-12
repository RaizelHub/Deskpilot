<?php

namespace App\Services;

use App\Jobs\AnalyzeTicket;
use App\Models\AiRun;
use App\Models\User;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

class AiService
{
    public function preview(User $user, string $ticket, ?string $diagnostic): array
    {
        $t = app(TicketAccess::class)->find($user, $ticket);
        $data = app(AiContext::class)->build($user, $t, $diagnostic);
        $settings = app(AiProvider::class)->settings();
        $expires = now()->addMinutes(10)->timestamp;

        return ['context' => $data['context'], 'settings' => $settings, 'token' => Crypt::encryptString(json_encode(['user' => $user->id, 'ticket' => $t->id, 'diagnostic' => $diagnostic, 'hash' => $data['hash'], 'provider' => $settings['provider'], 'model' => $settings['model'], 'expires' => $expires], JSON_THROW_ON_ERROR)), 'expires_at' => $expires];
    }

    public function request(User $user, string $ticket, string $token, string $key): AiRun
    {
        try {
            $consent = json_decode(Crypt::decryptString($token), true, 16, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            abort(422, 'Preview expired or invalid. Review a new preview.');
        }
        abort_unless(($consent['user'] ?? null) === $user->id && ($consent['ticket'] ?? null) === $ticket, 422, 'Preview does not match this ticket and user.');
        $settings = app(AiProvider::class)->settings();
        abort_unless($settings['ready'], 409, 'AI is disabled or not configured. Ask your administrator.');
        $created = false;
        $run = DB::transaction(function () use ($user, $ticket, $consent, $key, $settings, &$created) {
            $t = app(TicketAccess::class)->find($user, $ticket, true);
            $existing = AiRun::where('requested_by', $user->id)->where('request_key', $key)->first();
            if ($existing) {
                abort_unless($existing->ticket_id === $ticket && $existing->context_hash === $consent['hash'], 409, 'Request key already used.');

                return $existing;
            }
            abort_if($consent['expires'] < now()->timestamp, 409, 'Preview expired. Review the context again.');
            abort_unless($consent['provider'] === $settings['provider'] && $consent['model'] === $settings['model'], 409, 'AI configuration changed. Review a new preview.');
            $data = app(AiContext::class)->build($user, $t, $consent['diagnostic']);
            abort_unless(hash_equals($data['hash'], $consent['hash']), 409, 'Ticket or knowledge context changed. Review a new preview.');
            abort_if(AiRun::where('ticket_id', $ticket)->where('requested_by', $user->id)->whereIn('status', ['queued', 'running'])->exists(), 409, 'An analysis is already in progress.');
            DB::table('ai_usage_days')->insertOrIgnore(['day' => today()->toDateString(), 'requests' => 0]);
            $usage = DB::table('ai_usage_days')->where('day', today()->toDateString())->lockForUpdate()->first();
            abort_if($usage->requests >= config('ai.daily_limit'), 429, 'The daily AI request limit has been reached.');
            DB::table('ai_usage_days')->where('day', $usage->day)->increment('requests');
            $r = AiRun::create(['ticket_id' => $ticket, 'requested_by' => $user->id, 'diagnostic_id' => $consent['diagnostic'], 'request_key' => $key, 'provider' => $settings['provider'], 'model' => $settings['model'], 'status' => 'queued', 'context_hash' => $data['hash'], 'ticket_version' => $t->version]);
            foreach ($data['sources'] as $source) {
                $r->sources()->attach($source['id'], ['version' => $source['version']]);
            }
            app(Audit::class)->record('ai.requested', $user, $r, ['ticket_id' => $ticket, 'provider' => $r->provider, 'model' => $r->model]);
            $created = true;

            return $r;
        });
        if ($created) {
            try {
                AnalyzeTicket::dispatch($run->id);
            } catch (\Throwable) {
                $this->finish($run->id, 'queue_unavailable');
            }
        }

        return $run->fresh();
    }

    public function permitted(User $user, AiRun $run): bool
    {
        if (! $user->is_active || ! $user->email_verified_at || ! $user->hasPermission('ai.use') || ! app(TicketAccess::class)->query($user)->whereKey($run->ticket_id)->exists()) {
            return false;
        }
        if ($run->diagnostic_id && (! $user->hasPermission('devices.view') || ! $user->hasPermission('devices.diagnostics'))) {
            return false;
        }
        foreach ($run->sources()->get() as $source) {
            if (! app(KnowledgeService::class)->visible($user, true)->whereKey($source->id)->where('version', $source->pivot->version)->exists()) {
                return false;
            }
        }

        return true;
    }

    public function perform(string $id): void
    {
        $run = DB::transaction(function () use ($id) {
            $r = AiRun::whereKey($id)->lockForUpdate()->first();
            if (! $r || $r->status !== 'queued') {
                return null;
            }
            $r->update(['status' => 'running', 'started_at' => now()]);

            return $r;
        });
        if (! $run) {
            return;
        }
        try {
            if ($run->created_at->lt(now()->subMinutes(10))) {
                throw new \RuntimeException('worker_timeout');
            }
            $settings = app(AiProvider::class)->settings();
            if (! $settings['ready'] || $settings['provider'] !== $run->provider || $settings['model'] !== $run->model) {
                throw new \RuntimeException('provider_configuration');
            }
            $user = User::find($run->requested_by);
            if (! $user || ! $this->permitted($user, $run)) {
                throw new \RuntimeException('access_changed');
            }
            $ticket = app(TicketAccess::class)->find($user, $run->ticket_id);
            $data = app(AiContext::class)->build($user, $ticket, $run->diagnostic_id);
            if (! hash_equals($run->context_hash, $data['hash'])) {
                throw new \RuntimeException('context_changed');
            }
            $result = app(AiProvider::class)->analyze($data['context'], $run->provider, $run->model);
            $user = $user->fresh();
            $ticket = $ticket->fresh();
            if (! $this->permitted($user, $run)) {
                throw new \RuntimeException('access_changed');
            }
            if (! hash_equals($run->context_hash, app(AiContext::class)->build($user, $ticket, $run->diagnostic_id)['hash'])) {
                throw new \RuntimeException('context_changed');
            }
            $this->finish($id, null, $result);
        } catch (\Throwable $e) {
            $allowed = ['worker_timeout', 'provider_configuration', 'access_changed', 'context_changed', 'provider_authentication', 'provider_rate_limit', 'provider_unavailable', 'invalid_output', 'incomplete_output'];
            $this->finish($id, in_array($e->getMessage(), $allowed, true) ? $e->getMessage() : 'provider_unavailable');
        }
    }

    public function finish(string $id, ?string $error, ?array $result = null): void
    {
        DB::transaction(function () use ($id, $error, $result) {
            $r = AiRun::whereKey($id)->lockForUpdate()->first();
            if (! $r || ! in_array($r->status, ['queued', 'running'], true)) {
                return;
            }
            $r->update(['status' => $error ? 'failed' : 'completed', 'error_code' => $error, 'result' => $result, 'finished_at' => now()]);
            app(Audit::class)->record($error ? 'ai.failed' : 'ai.completed', null, $r, ['ticket_id' => $r->ticket_id, 'error_code' => $error]);
        });
    }

    public function expire(): void
    {
        AiRun::whereIn('status', ['queued', 'running'])->where('created_at', '<', now()->subMinutes(10))->pluck('id')->each(fn ($id) => $this->finish($id, 'worker_timeout'));
    }
}
