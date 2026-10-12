<?php

namespace Tests\Feature;

use App\Jobs\DeliverWebhook;
use App\Models\AppNotification;
use App\Models\AutomationEvent;
use App\Models\NotificationRule;
use App\Models\Role;
use App\Models\TicketCategory;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Services\AutomationEvents;
use App\Services\WebhookDeliveryService;
use App\Services\WebhookTransport;
use App\Services\WebhookUrlPolicy;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class AutomationTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $employee;

    private User $tech;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->admin = $this->account('it-administrator');
        $this->employee = $this->account('employee');
        $this->tech = $this->account('it-technician');
    }

    private function account($role): User
    {
        $u = User::factory()->create(['is_active' => true]);
        $u->roles()->attach(Role::where('slug', $role)->firstOrFail());

        return $u;
    }

    private function hook(): Webhook
    {
        $r = $this->actingAs($this->admin)->postJson('/api/v1/webhooks', ['name' => 'Receiver', 'url' => 'https://example.com/hook', 'events' => ['ticket.created'], 'enabled' => false])->assertCreated();
        $this->assertNotEmpty($r->json('secret'));
        $h = Webhook::findOrFail($r->json('data.id'));
        $this->assertNotSame($h->secret, DB::table('webhooks')->value('secret'));
        $h->update(['enabled' => true]);

        return $h;
    }

    private function delivery(): WebhookDelivery
    {
        $h = $this->hook();
        $e = app(AutomationEvents::class)->emit('ticket.created', 'test', null, ['test' => true]);

        return app(AutomationEvents::class)->delivery($h, $e);
    }

    public function test_permissions_secrets_versions_and_configuration_cancellation(): void
    {
        $d = $this->delivery();
        $h = $d->webhook;
        $this->getJson('/api/v1/automation')->assertOk()->assertJsonMissingPath('webhooks.0.secret');
        $this->postJson('/api/v1/webhooks/'.$h->id.'/rotate', ['version' => 1])->assertOk()->assertJsonPath('data.enabled', false);
        $this->assertSame('cancelled', $d->fresh()->status);
        $this->postJson('/api/v1/webhooks/'.$h->id.'/rotate', ['version' => 1])->assertConflict();
        $this->postJson('/api/v1/webhook-deliveries/'.$d->id.'/retry')->assertConflict();
        $this->actingAs($this->tech)->getJson('/api/v1/automation')->assertForbidden();
        $this->getJson('/api/v1/webhook-deliveries/'.$d->id)->assertForbidden();
        $this->actingAs($this->employee)->postJson('/api/v1/webhooks/'.$h->id.'/test')->assertForbidden();
    }

    public function test_retry_backoff_signature_stable_identity_and_attempt_limit(): void
    {
        $d = $this->delivery();
        $secret = $d->webhook->secret;
        $body = $d->event->body;
        $this->mock(WebhookTransport::class, function ($m) use ($d, $secret, $body) {
            $m->shouldReceive('send')->times(5)->withArgs(function ($url, $sent, $headers) use ($d, $secret, $body) {
                $this->assertSame($body, $sent);
                $this->assertContains('X-DeskPilot-Delivery: '.$d->id, $headers);
                $this->assertContains('X-DeskPilot-Signature: sha256='.hash_hmac('sha256', now()->timestamp.'.'.$body, $secret), $headers);

                return true;
            })->andReturn(['status' => 503, 'error' => null]);
        });
        $service = app(WebhookDeliveryService::class);
        foreach ([60, 300, 900, 3600, 3600] as $i => $delay) {
            $service->deliver($d->id);
            $d->refresh();
            $this->assertSame($i + 1, $d->attempts);
            $this->assertSame($i === 4 ? 'failed' : 'pending', $d->status);
            if ($i < 4) {
                $this->assertEqualsWithDelta($delay, now()->diffInSeconds($d->next_attempt_at), 1);
                $service->deliver($d->id);
                $this->assertSame($i + 1, $d->fresh()->attempts);
                $this->travel($delay)->seconds();
            }
        }$service->deliver($d->id);
        $this->assertDatabaseCount('webhook_attempts', 5);
    }

    public function test_success_and_terminal_errors_can_be_retried_without_duplicate_delivery(): void
    {
        $d = $this->delivery();
        $this->mock(WebhookTransport::class, fn ($m) => $m->shouldReceive('send')->once()->andReturn(['status' => 400, 'error' => null]));
        app(WebhookDeliveryService::class)->deliver($d->id);
        $this->assertSame('failed', $d->fresh()->status);
        $this->postJson('/api/v1/webhook-deliveries/'.$d->id.'/retry')->assertAccepted();
        $this->mock(WebhookTransport::class, fn ($m) => $m->shouldReceive('send')->once()->andReturn(['status' => 204, 'error' => null]));
        app(WebhookDeliveryService::class)->deliver($d->id);
        $this->assertSame('succeeded', $d->fresh()->status);
        $this->assertSame(2, $d->fresh()->attempts);
        $this->assertDatabaseCount('webhook_deliveries', 1);
    }

    public function test_dispatch_queues_work_and_suppresses_duplicate_enqueues(): void
    {
        Queue::fake();
        $d = $this->delivery();
        $s = app(WebhookDeliveryService::class);
        $this->assertSame(1, $s->dispatchDue());
        $this->assertSame(0, $s->dispatchDue());
        Queue::assertPushed(DeliverWebhook::class, 1);
        $this->assertSame(0, $d->fresh()->attempts);
        $this->travel(181)->seconds();
        $this->assertSame(1, $s->dispatchDue());
    }

    public function test_private_mixed_dns_redirect_style_urls_and_multicast_are_blocked(): void
    {
        $p = new class extends WebhookUrlPolicy
        {
            public function addresses(string $host): array
            {
                return ['93.184.216.34', '127.0.0.1'];
            }
        };
        foreach (['http://example.com/hook', 'https://127.0.0.1/hook', 'https://10.0.0.1', 'https://169.254.169.254', 'https://224.0.0.1', 'https://example.com:444', 'https://user:pass@example.com', 'https://example.com?secret=x', 'https://example.com/hook'] as $url) {
            try {
                $p->resolve($url);
                $this->fail('Allowed '.$url);
            } catch (\InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }config(['deskpilot.webhook_allow_loopback_http' => true]);
        $this->assertSame('127.0.0.1', $p->resolve('http://127.0.0.1:8099/hook')['ip']);
    }

    public function test_ticket_events_notifications_deduplication_and_current_access(): void
    {
        $this->hook();
        $t = $this->actingAs($this->employee)->postJson('/api/v1/tickets', ['title' => 'Private VPN issue', 'description' => 'Private description must never enter outbound payload', 'priority' => 'high', 'category_id' => TicketCategory::first()->id])->assertCreated()->json('data');
        $t = $this->actingAs($this->admin)->patchJson('/api/v1/tickets/'.$t['id'], ['version' => 1, 'assignee_id' => $this->tech->id])->assertOk()->json('data');
        $this->actingAs($this->tech)->getJson('/api/v1/notifications')->assertJsonPath('unread_count', 1);
        $n = AppNotification::where('user_id', $this->tech->id)->firstOrFail();
        $this->actingAs($this->employee)->postJson('/api/v1/notifications/'.$n->id.'/read')->assertNotFound();
        $this->actingAs($this->admin)->patchJson('/api/v1/tickets/'.$t['id'], ['version' => $t['version'], 'status' => 'resolved', 'resolution_notes' => 'Private resolution'])->assertOk();
        $this->actingAs($this->employee)->getJson('/api/v1/notifications')->assertJsonPath('unread_count', 1);
        $this->postJson('/api/v1/notifications/read-all')->assertNoContent();
        $this->getJson('/api/v1/notifications?unread=1')->assertJsonPath('total', 0);
        $this->tech->roles()->sync([Role::where('slug', 'employee')->value('id')]);
        $this->withSession(['auth_version' => $this->tech->fresh()->auth_version])->actingAs($this->tech->fresh())->getJson('/api/v1/notifications')->assertJsonPath('total', 0);
        $this->postJson('/api/v1/notifications/'.$n->id.'/read')->assertNotFound();
        foreach (AutomationEvent::all() as $e) {
            $this->assertStringNotContainsString('Private', $e->body);
        }$this->assertDatabaseCount('webhook_deliveries', 1);
    }

    public function test_outbox_rolls_back_with_business_transaction(): void
    {
        $this->hook();
        try {
            DB::transaction(function () {
                app(AutomationEvents::class)->emit('ticket.created', 'test', null, []);
                throw new \RuntimeException('rollback');
            });
        } catch (\RuntimeException) {
        }$this->assertDatabaseCount('automation_events', 0);
        $this->assertDatabaseCount('webhook_deliveries', 0);
    }

    public function test_rule_validation_and_stale_update(): void
    {
        $this->actingAs($this->admin);
        $r = NotificationRule::first();
        $payload = ['name' => 'Rule check', 'event' => 'ticket.created', 'audience' => 'remote_customer', 'priority' => null, 'enabled' => true];
        $this->postJson('/api/v1/notification-rules', $payload)->assertUnprocessable();
        $payload['audience'] = 'ticket_requester';
        $this->patchJson('/api/v1/notification-rules/'.$r->id, [...$payload, 'version' => 1])->assertOk();
        $this->patchJson('/api/v1/notification-rules/'.$r->id, [...$payload, 'version' => 1])->assertConflict();
    }
}
