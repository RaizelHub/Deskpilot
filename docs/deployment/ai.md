# Enable Groq or Gemini

AI is optional. Keep AI_ENABLED=false to use tickets, diagnostics and the knowledge base without an external AI provider. Configure secrets only in apps/server/.env or your deployment secret manager. Do not put keys in frontend variables, screenshots, workflow exports or Git.

## Groq

```dotenv
AI_ENABLED=true
AI_PROVIDER=groq
AI_MODEL=openai/gpt-oss-20b
GROQ_API_KEY=your-server-side-key
AI_DAILY_LIMIT=100
```

Use a Groq model that supports strict JSON-schema output; openai/gpt-oss-20b is an example listed in the [Groq structured-output documentation](https://console.groq.com/docs/structured-outputs). Confirm model availability in your account before enabling it. This is a Groq-hosted model request, not an OpenAI API integration.

## Gemini

```dotenv
AI_ENABLED=true
AI_PROVIDER=gemini
AI_MODEL=your-supported-gemini-model-id
GEMINI_API_KEY=your-server-side-key
AI_DAILY_LIMIT=100
```

Set an available Gemini text model supporting JSON-schema generation. The adapter uses generateContent, x-goog-api-key and generationConfig.responseFormat.text as documented in the [Gemini structured-output REST guide](https://ai.google.dev/gemini-api/docs/generate-content/structured-output). Model IDs and account availability change; no model is silently selected or downloaded. The example above deliberately requires you to supply a model ID.

The implementation uses [Groq Chat Completions](https://console.groq.com/docs/api-reference) and [Gemini generateContent](https://ai.google.dev/api/generate-content), with fixed provider hosts. Local/proxy endpoints and automatic provider fallback are not supported. Changing provider/model requires new previews and fails queued runs from the old configuration. Keys stay on the server and are never returned by configuration-readiness APIs.

## Deploy and verify

1. Apply `php artisan migrate --force` from apps/server. Migration 000010 is additive; do not rerun demo seeders on an existing installation.
2. Use a persistent queue: database, redis, sqs or beanstalkd. Sync, deferred/background, null and failover configurations are not treated as AI-ready. For local use, set QUEUE_CONNECTION=database.
3. Refresh cached configuration and restart workers after changing credentials: `php artisan config:clear` in development, or rebuild config cache during deployment, then `php artisan queue:restart`.
4. Run a supervised worker, for example `php artisan queue:work --tries=1 --timeout=60`. Keep queue retry_after greater than 60 seconds; the default 90 seconds is suitable. The AI job has its own 50-second timeout and the provider call times out at 35 seconds. Run the existing scheduler so stalled analyses expire. Docker Compose already sets a 60-second worker timeout. Its global tries setting does not override the AI job's explicit one-attempt limit.
5. Publish a small knowledge article, create a nonsensitive test ticket, and open AI analysis as a support user. Review the exact context and confirm sending. Check a completed structured result, article links, and that ticket fields remain unchanged. Test an invalid key to confirm a sanitized failure. Do not treat configuration readiness as a successful connection test.
6. Confirm organization approval for sending reviewed ticket/diagnostic content to the selected provider and configure suitable provider-side quotas. AI_DAILY_LIMIT controls accepted request count, not spend or token cost.

The UI warns that redaction is incomplete. Diagnostic details may contain IP addresses/hostnames; article or ticket text can contain personal information. Provider retention and account terms are not overridden by DeskPilot. A published article remains usable locally when AI is disabled.

## Troubleshooting

- Not configured: verify enabled flag, provider, nonempty key/model and persistent queue. Restart long-running workers after configuration changes.
- Waiting in queue: check the queue worker. After ten minutes a scheduler pass marks the run expired; stale queued jobs cannot send later.
- Provider authentication: correct the selected provider key and account access. Do not paste provider error bodies into logs.
- Invalid/incomplete response: check the model supports the selected structured-output API, then review a new preview. No automatic fallback or retry is attempted.
- Context changed: ticket or retrieved articles changed between review and execution; review again.
- Result unavailable: current permissions or source visibility/version changed.

## Verification scope

`php artisan test --filter=AiKnowledgeTest` checks both adapters using Laravel HTTP fakes. `node scripts/ai-browser-check.mjs` uses a real disposable PostgreSQL database, session/CSRF flow and queue job with a guarded test-only provider worker. Fixture screenshots explicitly identify test output. The worker refuses to run unless the dedicated browser-database/environment guard is set. No fixture is loaded by the application or normal worker.

Live provider acceptance remains a deployment step requiring your key/model. No API credits were used and no real customer data was sent during implementation.
