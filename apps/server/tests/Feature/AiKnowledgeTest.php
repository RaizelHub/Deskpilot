<?php

namespace Tests\Feature;

use App\Jobs\AnalyzeTicket;
use App\Models\AiRun;
use App\Models\Device;
use App\Models\DeviceCommand;
use App\Models\KnowledgeArticle;
use App\Models\KnowledgeCategory;
use App\Models\Role;
use App\Models\Ticket;
use App\Models\TicketCategory;
use App\Models\User;
use App\Services\AiContext;
use App\Services\AiProvider;
use App\Services\AiService;
use App\Services\KnowledgeService;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

class AiKnowledgeTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $tech;

    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->admin = $this->account('it-administrator');
        $this->tech = $this->account('it-technician');
        $this->employee = $this->account('employee');
        Http::preventStrayRequests();
        Queue::fake();
        config(['queue.default' => 'database', 'ai.enabled' => true, 'ai.provider' => 'groq', 'ai.model' => 'openai/gpt-oss-20b', 'ai.groq_key' => 'test-key-not-real']);
    }

    private function account($role): User
    {
        $u = User::factory()->create(['is_active' => true]);
        $u->roles()->attach(Role::where('slug', $role)->firstOrFail());

        return $u;
    }

    private function ticket(): Ticket
    {
        $r = $this->actingAs($this->employee)->postJson('/api/v1/tickets', ['title' => 'DNS cannot resolve websites', 'description' => 'DNS lookup failed. password=secret123 user@example.test', 'priority' => 'medium', 'category_id' => TicketCategory::first()->id])->assertCreated();

        return Ticket::findOrFail($r->json('data.id'));
    }

    private function article(array $extra = []): KnowledgeArticle
    {
        return app(KnowledgeService::class)->save($this->admin, array_merge(['title' => 'DNS troubleshooting', 'summary' => 'Read-only checks for DNS resolution.', 'body' => '## DNS checks'."\n\n".'Run the approved DNS diagnostic and compare the result with the gateway test.', 'category_id' => KnowledgeCategory::first()->id, 'visibility' => 'staff', 'status' => 'published', 'tags' => ['dns', 'network']], $extra), null);
    }

    private function queueAnalysis(Ticket $t): AiRun
    {
        $this->actingAs($this->tech);
        $p = $this->postJson('/api/v1/tickets/'.$t->id.'/ai/preview', ['diagnostic_id' => null])->assertOk()->json();

        return AiRun::findOrFail($this->postJson('/api/v1/tickets/'.$t->id.'/ai', ['token' => $p['token'], 'request_key' => (string) Str::uuid()])->assertAccepted()->json('data.id'));
    }

    private function providerResult(Ticket $t, array $extra = []): array
    {
        return array_merge(['summary' => 'The user reports websites failing to resolve.', 'category_id' => $t->category_id, 'priority' => 'medium', 'likely_cause' => 'DNS resolution may be failing.', 'diagnostic_interpretation' => 'No diagnostic supplied.', 'steps' => ['Confirm whether other sites are affected.'], 'diagnostic_commands' => ['network.test_dns'], 'article_ids' => [], 'limitations' => ['No diagnostic evidence supplied.']], $extra);
    }

    private function groq(array $output): void
    {
        Http::swap(new Factory);
        Http::preventStrayRequests();
        Http::fake(['api.groq.com/*' => Http::response(['choices' => [['finish_reason' => 'stop', 'message' => ['content' => json_encode($output)]]]])]);
    }

    public function test_common_credential_formats_are_redacted_and_sync_queue_is_not_ready(): void
    {
        $redactor = app(AiContext::class);
        foreach (['Authorization: Bearer abcdef123456', '"password": "multi word secret"', 'api_key=credential-value', "-----BEGIN PRIVATE KEY-----\nprivate-value\n-----END PRIVATE KEY-----"] as $value) {
            $clean = $redactor->redact($value);
            foreach (['abcdef123456', 'multi word secret', 'credential-value', 'private-value'] as $secret) {
                $this->assertStringNotContainsString($secret, $clean);
            }
        }
        $this->assertTrue(app(AiProvider::class)->settings()['ready']);
        config(['queue.default' => 'sync']);
        $this->assertFalse(app(AiProvider::class)->settings()['ready']);
    }

    public function test_knowledge_visibility_search_tags_and_conflicting_edits(): void
    {
        $staff = $this->article();
        $public = $this->article(['title' => 'DNS employee guide', 'visibility' => 'everyone']);
        $draft = $this->article(['status' => 'draft']);
        $this->actingAs($this->employee)->getJson('/api/v1/knowledge?search=DNS')->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/v1/knowledge/'.$staff->id)->assertNotFound();
        $this->getJson('/api/v1/knowledge/'.$draft->id)->assertNotFound();
        $this->getJson('/api/v1/knowledge?tag=dns')->assertJsonPath('total', 1);
        $this->actingAs($this->tech)->getJson('/api/v1/knowledge')->assertJsonPath('total', 2);
        $this->postJson('/api/v1/knowledge', [])->assertForbidden();
        $data = $public->only(['title', 'summary', 'body', 'category_id', 'visibility', 'status']);
        $data['tags'] = ['DNS'];
        $this->actingAs($this->admin)->patchJson('/api/v1/knowledge/'.$public->id, [...$data, 'version' => 1])->assertOk()->assertJsonPath('data.version', 2);
        $this->patchJson('/api/v1/knowledge/'.$public->id, [...$data, 'version' => 1])->assertConflict();
    }

    public function test_markdown_strips_html_unsafe_links_and_images(): void
    {
        $a = $this->article(['body' => "# Guidance\n<script>alert(1)</script>\n[Bad](javascript:alert(1))\n![Image](https://example.com/track.png)\n**Safe text**"]);
        $html = $this->actingAs($this->tech)->getJson('/api/v1/knowledge/'.$a->id)->assertOk()->json('html');
        $this->assertStringNotContainsString('<script', $html);
        $this->assertStringNotContainsString('href="javascript:', $html);
        $this->assertStringNotContainsString('<img', $html);
        $this->assertStringContainsString('<strong>Safe text</strong>', $html);
    }

    public function test_disabled_ai_and_employee_access_never_call_provider(): void
    {
        $t = $this->ticket();
        $this->getJson('/api/v1/tickets/'.$t->id.'/ai')->assertForbidden();
        config(['ai.enabled' => false]);
        $this->actingAs($this->tech);
        $preview = $this->postJson('/api/v1/tickets/'.$t->id.'/ai/preview', ['diagnostic_id' => null])->assertOk()->assertJsonPath('settings.ready', false)->json();
        $this->postJson('/api/v1/tickets/'.$t->id.'/ai', ['token' => $preview['token'], 'request_key' => (string) Str::uuid()])->assertConflict();
        Http::assertNothingSent();
        Queue::assertNothingPushed();
    }

    public function test_preview_redaction_private_notes_and_diagnostic_binding(): void
    {
        $t = $this->ticket();
        $t->comments()->create(['author_id' => $this->tech->id, 'body' => 'INTERNAL DO NOT SHARE', 'is_internal' => true]);
        $this->article();
        $p = $this->actingAs($this->tech)->postJson('/api/v1/tickets/'.$t->id.'/ai/preview', ['diagnostic_id' => null])->assertOk()->json();
        $context = json_encode($p['context']);
        $this->assertStringNotContainsString('secret123', $context);
        $this->assertStringNotContainsString('user@example.test', $context);
        $this->assertStringNotContainsString('INTERNAL', $context);
        $this->assertCount(1, $p['context']['articles']);
        $this->postJson('/api/v1/tickets/'.$t->id.'/ai/preview', ['diagnostic_id' => (string) Str::uuid()])->assertNotFound();
        $t->increment('version');
        $this->postJson('/api/v1/tickets/'.$t->id.'/ai', ['token' => $p['token'], 'request_key' => (string) Str::uuid()])->assertConflict();
        Http::assertNothingSent();
    }

    public function test_queued_groq_analysis_is_private_encrypted_and_does_not_mutate_ticket(): void
    {
        $t = $this->ticket();
        $r = $this->queueAnalysis($t);
        Queue::assertPushed(AnalyzeTicket::class, 1);
        $this->groq($this->providerResult($t));
        app(AiService::class)->perform($r->id);
        $this->assertSame('completed', $r->fresh()->status);
        $this->assertStringNotContainsString('reports websites', DB::table('ai_runs')->where('id', $r->id)->value('result'));
        $this->assertSame(1, $t->fresh()->version);
        $this->assertDatabaseCount('device_commands', 0);
        Http::assertSent(fn ($request) => $request->url() === 'https://api.groq.com/openai/v1/chat/completions' && $request->hasHeader('Authorization', 'Bearer test-key-not-real') && $request['response_format']['json_schema']['strict'] === true && ! isset($request['tools']));
        $this->getJson('/api/v1/tickets/'.$t->id.'/ai')->assertJsonPath('runs.data.0.analysis.summary', $this->providerResult($t)['summary'])->assertJsonMissingPath('runs.data.0.context_hash');
        $this->actingAs($this->admin)->getJson('/api/v1/tickets/'.$t->id.'/ai')->assertJsonPath('runs.total', 0);
    }

    public function test_gemini_request_mapping_and_refusal_handling(): void
    {
        config(['ai.provider' => 'gemini', 'ai.model' => 'gemini-3.8-flash', 'ai.gemini_key' => 'test-google-key']);
        $t = $this->ticket();
        $r = $this->queueAnalysis($t);
        Http::fake(['generativelanguage.googleapis.com/*' => Http::response(['candidates' => [['finishReason' => 'STOP', 'content' => ['parts' => [['text' => json_encode($this->providerResult($t))]]]]]])]);
        app(AiService::class)->perform($r->id);
        $this->assertSame('completed', $r->fresh()->status);
        Http::assertSent(fn ($request) => $request->hasHeader('x-goog-api-key', 'test-google-key') && ! str_contains($request->url(), 'key=') && $request['generationConfig']['responseFormat']['text']['mimeType'] === 'application/json');
        $r2 = $this->queueAnalysis($t);
        Http::swap(new Factory);
        Http::preventStrayRequests();
        Http::fake(['generativelanguage.googleapis.com/*' => Http::response(['candidates' => [['finishReason' => 'SAFETY']]])]);
        app(AiService::class)->perform($r2->id);
        $this->assertSame('incomplete_output', $r2->fresh()->error_code);
    }

    public function test_output_rejects_unapproved_commands_and_invented_sources(): void
    {
        $t = $this->ticket();
        foreach ([['diagnostic_commands' => ['execute_arbitrary_command']], ['article_ids' => [(string) Str::uuid()]], ['category_id' => (string) Str::uuid()]] as $bad) {
            $r = $this->queueAnalysis($t);
            $this->groq($this->providerResult($t, $bad));
            app(AiService::class)->perform($r->id);
            $this->assertSame('invalid_output', $r->fresh()->error_code);
            $this->assertNull($r->fresh()->result);
        }$this->assertDatabaseCount('device_commands', 0);
    }

    public function test_permission_loss_and_disabled_provider_cancel_queued_analysis(): void
    {
        $t = $this->ticket();
        $r = $this->queueAnalysis($t);
        config(['ai.enabled' => false]);
        app(AiService::class)->perform($r->id);
        $this->assertSame('provider_configuration', $r->fresh()->error_code);
        config(['ai.enabled' => true]);
        $r = $this->queueAnalysis($t);
        $this->tech->roles()->sync([Role::where('slug', 'employee')->value('id')]);
        app(AiService::class)->perform($r->id);
        $this->assertSame('access_changed', $r->fresh()->error_code);
        Http::assertNothingSent();
    }

    public function test_archived_source_hides_saved_analysis_and_changed_context_prevents_send(): void
    {
        $t = $this->ticket();
        $a = $this->article();
        $r = $this->queueAnalysis($t);
        $this->groq($this->providerResult($t, ['article_ids' => [$a->id]]));
        app(AiService::class)->perform($r->id);
        $this->assertSame('completed', $r->fresh()->status);
        $a->update(['status' => 'archived', 'version' => 2]);
        $this->getJson('/api/v1/tickets/'.$t->id.'/ai')->assertJsonPath('runs.data.0.restricted', true)->assertJsonPath('runs.data.0.analysis', null);
        $r2 = $this->queueAnalysis($t);
        $t->increment('version');
        app(AiService::class)->perform($r2->id);
        $this->assertSame('context_changed', $r2->fresh()->error_code);
        Http::assertSentCount(1);
    }

    public function test_idempotency_budget_and_expired_preview(): void
    {
        $t = $this->ticket();
        config(['ai.daily_limit' => 1]);
        $this->actingAs($this->tech);
        $p = $this->postJson('/api/v1/tickets/'.$t->id.'/ai/preview', ['diagnostic_id' => null])->json();
        $key = (string) Str::uuid();
        $s = app(AiService::class);
        $r = $s->request($this->tech, $t->id, $p['token'], $key);
        $same = $s->request($this->tech, $t->id, $p['token'], $key);
        $this->assertSame($r->id, $same->id);
        $this->assertDatabaseCount('ai_runs', 1);
        Queue::assertPushed(AnalyzeTicket::class, 1);
        $s->finish($r->id, 'worker_failed');
        $this->postJson('/api/v1/tickets/'.$t->id.'/ai', ['token' => $p['token'], 'request_key' => (string) Str::uuid()])->assertStatus(429);
        $this->travel(11)->minutes();
        $this->postJson('/api/v1/tickets/'.$t->id.'/ai', ['token' => $p['token'], 'request_key' => (string) Str::uuid()])->assertConflict();
    }

    public function test_provider_errors_are_sanitized_and_stalled_runs_expire(): void
    {
        $t = $this->ticket();
        $r = $this->queueAnalysis($t);
        Http::fake(['api.groq.com/*' => Http::response(['error' => ['message' => 'secret upstream payload']], 401)]);
        app(AiService::class)->perform($r->id);
        $this->assertSame('provider_authentication', $r->fresh()->error_code);
        $this->assertStringNotContainsString('secret upstream', $this->getJson('/api/v1/tickets/'.$t->id.'/ai')->getContent());
        $r = $this->queueAnalysis($t);
        $this->travel(11)->minutes();
        app(AiService::class)->expire();
        $this->assertSame('worker_timeout', $r->fresh()->error_code);
        app(AiService::class)->perform($r->id);
        Http::assertSentCount(1);
    }

    public function test_linked_diagnostic_is_explicit_and_ticket_bound(): void
    {
        $t = $this->ticket();
        $device = Device::create(['name' => 'Test PC', 'hostname' => 'TEST', 'agent_version' => '0.7.0']);
        $d = DeviceCommand::create(['device_id' => $device->id, 'requested_by' => $this->tech->id, 'ticket_id' => $t->id, 'request_key' => (string) Str::uuid(), 'command' => 'network.test_dns', 'reason' => 'Test', 'status' => 'failed', 'expires_at' => now(), 'finished_at' => now(), 'summary' => 'DNS lookup failed', 'result' => [['name' => 'DNS resolution', 'status' => 'fail', 'detail' => 'Lookup failed']]]);
        $this->actingAs($this->tech)->postJson('/api/v1/tickets/'.$t->id.'/ai/preview', ['diagnostic_id' => $d->id])->assertOk()->assertJsonPath('context.diagnostic.checks.0.status', 'fail');
        $other = $this->ticket();
        $this->actingAs($this->tech)->postJson('/api/v1/tickets/'.$other->id.'/ai/preview', ['diagnostic_id' => $d->id])->assertNotFound();
    }
}
