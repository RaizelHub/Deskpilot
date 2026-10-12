<?php

namespace App\Http\Controllers;

use App\Models\NotificationRule;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Services\Audit;
use App\Services\AutomationEvents;
use App\Services\WebhookUrlPolicy;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AutomationController extends Controller
{
    public function index()
    {
        return response()->json(['webhooks' => Webhook::with('subscriptions')->orderBy('name')->get(), 'events' => AutomationEvents::EVENTS, 'rules' => NotificationRule::orderBy('name')->get(), 'health' => DB::table('automation_runs')->where('name', 'webhooks')->first(), 'counts' => ['pending' => WebhookDelivery::whereIn('status', ['pending', 'sending'])->count(), 'failed' => WebhookDelivery::where('status', 'failed')->count(), 'succeeded' => WebhookDelivery::where('status', 'succeeded')->count()]]);
    }

    public function save(Request $r, ?string $webhook = null)
    {
        $d = $r->validate(['name' => 'required|string|min:2|max:100', 'url' => 'required|string|max:2000', 'events' => 'required|array|min:1|max:30', 'events.*' => ['required', 'distinct', Rule::in(AutomationEvents::EVENTS)], 'enabled' => 'required|boolean', 'version' => $webhook ? 'required|integer|min:1' : 'prohibited']);
        try {
            app(WebhookUrlPolicy::class)->validate($d['url']);
        } catch (\InvalidArgumentException $e) {
            abort(422, $e->getMessage());
        }

        return DB::transaction(function () use ($r, $d, $webhook) {
            $secret = null;
            $hook = $webhook ? Webhook::whereKey($webhook)->lockForUpdate()->firstOrFail() : new Webhook;
            if ($webhook) {
                abort_if($hook->version !== $d['version'], 409, 'This webhook changed. Refresh before saving.');
                $hook->version++;
                $this->cancel($hook);
            } else {
                $secret = bin2hex(random_bytes(32));
                $hook->secret = $secret;
                $hook->version = 1;
                abort_if($d['enabled'], 422, 'Create the webhook disabled, configure the receiver, then enable it.');
            }
            $hook->fill(['name' => $d['name'], 'url' => $d['url'], 'enabled' => $d['enabled']])->save();
            $hook->subscriptions()->delete();
            $hook->subscriptions()->createMany(array_map(fn ($e) => ['event' => $e], $d['events']));
            app(Audit::class)->record($webhook ? 'webhook.updated' : 'webhook.created', $r->user(), $hook, ['name' => $hook->name, 'enabled' => $hook->enabled, 'events' => $d['events']]);

            return response()->json(['data' => $hook->load('subscriptions'), ...($secret ? ['secret' => $secret] : [])], $webhook ? 200 : 201)->header('Cache-Control', 'no-store');
        });
    }

    private function cancel(Webhook $hook): void
    {
        WebhookDelivery::where('webhook_id', $hook->id)->whereIn('status', ['pending', 'sending'])->update(['status' => 'cancelled', 'completed_at' => now(), 'last_error' => 'configuration_changed']);
    }

    public function rotate(Request $r, string $webhook)
    {
        $d = $r->validate(['version' => 'required|integer|min:1']);

        return DB::transaction(function () use ($r, $webhook, $d) {
            $hook = Webhook::whereKey($webhook)->lockForUpdate()->firstOrFail();
            abort_if($hook->version !== $d['version'], 409, 'This webhook changed. Refresh first.');
            $secret = bin2hex(random_bytes(32));
            $hook->update(['secret' => $secret, 'enabled' => false, 'version' => $hook->version + 1]);
            $this->cancel($hook);
            app(Audit::class)->record('webhook.secret_rotated', $r->user(), $hook);

            return response()->json(['secret' => $secret, 'data' => $hook])->header('Cache-Control', 'no-store');
        });
    }

    public function test(Request $r, string $webhook)
    {
        return DB::transaction(function () use ($r, $webhook) {
            $hook = Webhook::whereKey($webhook)->lockForUpdate()->firstOrFail();
            abort_unless($hook->enabled, 409, 'Enable this webhook before sending a test.');
            $event = app(AutomationEvents::class)->emit('webhook.test', 'test', null, ['test' => true]);
            $d = app(AutomationEvents::class)->delivery($hook, $event);
            app(Audit::class)->record('webhook.test_requested', $r->user(), $hook, ['delivery_id' => $d->id]);

            return response()->json(['data' => $d], 202);
        });
    }

    public function deliveries(Request $r)
    {
        $d = $r->validate(['page' => 'integer|min:1', 'status' => ['nullable', Rule::in(['pending', 'sending', 'succeeded', 'failed', 'cancelled'])], 'webhook_id' => 'nullable|uuid']);

        return WebhookDelivery::with(['webhook:id,name', 'event:id,event,created_at'])->when($d['status'] ?? null, fn ($q, $v) => $q->where('status', $v))->when($d['webhook_id'] ?? null, fn ($q, $v) => $q->where('webhook_id', $v))->latest()->orderByDesc('id')->paginate(15);
    }

    public function show(string $delivery)
    {
        $d = WebhookDelivery::with(['event', 'webhook:id,name'])->findOrFail($delivery);

        return response()->json(['data' => $d, 'attempts' => $d->attemptsLog()->orderByDesc('number')->limit(100)->get()]);
    }

    public function retry(Request $r, string $delivery)
    {
        return DB::transaction(function () use ($r, $delivery) {
            $initial = WebhookDelivery::findOrFail($delivery);
            $hook = Webhook::whereKey($initial->webhook_id)->lockForUpdate()->firstOrFail();
            $d = WebhookDelivery::whereKey($delivery)->lockForUpdate()->firstOrFail();
            abort_unless($hook->enabled, 409, 'Enable the webhook first.');
            abort_unless(in_array($d->status, ['failed', 'cancelled'], true), 409, 'Only failed or cancelled deliveries may be retried.');
            $d->update(['status' => 'pending', 'webhook_version' => $hook->version, 'cycle_attempts' => 0, 'next_attempt_at' => now(), 'queued_at' => null, 'lease_until' => null, 'lease_token' => null, 'completed_at' => null, 'last_error' => null]);
            app(Audit::class)->record('webhook.delivery_retried', $r->user(), $d);

            return response()->json(['data' => $d], 202);
        });
    }

    public function rule(Request $r, ?string $rule = null)
    {
        $d = $r->validate(['name' => 'required|string|min:2|max:100', 'event' => ['required', Rule::in(AutomationEvents::EVENTS)], 'audience' => ['required', Rule::in(AutomationEvents::audiences((string) $r->input('event')))], 'priority' => ['present', 'nullable', Rule::in(['low', 'medium', 'high', 'critical'])], 'enabled' => 'required|boolean', 'version' => $rule ? 'required|integer|min:1' : 'prohibited']);
        abort_if($d['priority'] && ! str_starts_with($d['event'], 'ticket.'), 422, 'Priority filters apply to ticket events only.');

        return DB::transaction(function () use ($r, $d, $rule) {
            $m = $rule ? NotificationRule::whereKey($rule)->lockForUpdate()->firstOrFail() : new NotificationRule;
            if ($rule) {
                abort_if($m->version !== $d['version'], 409, 'This rule changed. Refresh first.');
            }$m->fill([...$d, 'version' => ($m->version ?? 0) + 1])->save();
            app(Audit::class)->record('automation.rule_saved',$r->user(),$m,['event' => $m->event, 'audience' => $m->audience, 'enabled' => $m->enabled]);

            return response()->json(['data' => $m],$rule ? 200 : 201);
        });
    }
}
