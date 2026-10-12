# Phase 9 — Optional AI and knowledge base

Implemented: ticket summaries, suggested category/priority, interpretation of an explicitly selected completed diagnostic, troubleshooting recommendations, and retrieval from published knowledge articles. Groq and Gemini are supported through separate request/response mappings in the Laravel provider service. AI is disabled by default and requires a server-side key, an explicitly configured model, and a persistent queue. No automatic analysis runs on ticket creation.

## Workflow

A support user opens a ticket, optionally chooses one of its latest 20 completed diagnostic results, and selects Review context for AI. The dialog shows the exact bounded, redacted JSON context that will be sent. Confirming submits an encrypted preview token and a UUID request key. Preview tokens expire after ten minutes and bind the requester, ticket, diagnostic, context digest, provider and model. Changes to the ticket, retrieved article versions, or relevant context require another review.

The queue worker rechecks active/verified user status, permissions, ticket scope, source visibility/version and context digest before calling the provider. It checks these again before saving a result. Provider calls use fixed HTTPS hosts, verified TLS, no redirects/proxies, a five-second connection timeout and 35-second request timeout. No tools, browsing, code execution or function calls are provided to the model.

Results contain a summary, suggested category/priority, possible cause, diagnostic interpretation, up to eight steps, allowlisted diagnostic IDs, supplied article IDs and limitations. JSON shape, length bounds, category membership, diagnostic membership and source membership are validated independently of provider schema enforcement. Refused, incomplete, malformed or invalid output becomes a generic failed analysis. A structurally valid answer may still be wrong: technicians must review it.

AI does not edit, classify, resolve or comment on a ticket automatically. Suggestions are separate from ticket fields. Existing ticket edits and the device Diagnostics workflow remain the way to act, with their existing permissions, version checks and audits. The model has no access to a command execution path. Live remote control remains Phase 6 integration-pending.

## Context and privacy

Context is limited to title (160 characters), description (6,000), status/priority, the latest eight public replies (1,000 each), an optional selected diagnostic (summary plus up to 24 checks, 500 detail characters each), up to three relevant article excerpts (3,000 each), available ticket categories and diagnostic IDs. Diagnostic completion time is included. Internal notes, attachments, requester/technician profile fields and other tickets are excluded. Free text can still contain names, network addresses or confidential information.

Common credential assignments, bearer tokens, known key prefixes, private-key blocks and email addresses receive best-effort redaction. Redaction is not comprehensive and can remove surrounding context. The review dialog explicitly requires inspection before sending. Fix the underlying ticket/article if the preview contains material that must not leave the organization. Provider data-handling terms and the selected account tier must be reviewed by the deploying organization. No claim of zero retention is made.

Only the requesting user can list their analysis runs, and current ticket/AI permissions are required. Results that used diagnostics also require current device-view/diagnostic permissions. If a cited/context article changes version, is archived, or becomes inaccessible, the saved result is hidden. A later ticket update marks remaining accessible results as based on an older version.

Results are encrypted using Laravel's application key; raw prompts are reconstructed and are not duplicated in the analysis table. Source IDs/versions and a context hash are retained. Job payloads carry only the run UUID. Audit records include run/ticket IDs, provider/model and sanitized status codes, not prompts, output or credentials. Provider response bodies and exception messages are not exposed or logged by this feature. Disable external HTTP request tracing that could otherwise capture sensitive content.

## Knowledge base

Articles support Markdown, categories, tags, summary, draft/published/archived status and Everyone/Support staff visibility. Everyone means authenticated organization members, not anonymous public access. Publishing and editing require knowledge.manage; staff-only reading additionally requires knowledge.staff. Employees see only published Everyone articles. Raw HTML and unsafe links are stripped by CommonMark; embedded images are removed to prevent automatic external resource loads. Article content still requires editorial review.

PostgreSQL full-text search uses a GIN index over title, summary and body with the simple dictionary. Search is lexical, not semantic/vector search. Related/retrieved articles use up to 12 filtered tokens joined with OR, rank matching published accessible articles and return at most three. Article content is treated as untrusted evidence in the model instruction. There are no seeded pretend knowledge articles, embedding calls or cross-organization retrieval.

## Storage and access

Migration 000010 adds knowledge_categories, knowledge_articles, knowledge_article_tags, ai_runs, ai_run_sources and ai_usage_days. It seeds category labels and grants knowledge.view to existing standard roles, knowledge.staff/ai.use to support roles, and knowledge.manage to administrators without resetting existing roles. The role seeder is updated for new installations. Editing articles uses optimistic versions and atomic audit writes. Article archival retains references.

Analysis creation and daily quota accounting are transactional. A UUID request key deduplicates repeats by requester; only one queued/running analysis per requester/ticket is allowed. Named limits separate preview (15/minute) from generation (3/minute), per user. The organization-wide default is 100 accepted requests per application-calendar day, configurable from 1 to 500. It is a request-count cap, not a monetary budget; accepted requests count even when later failed. No automatic provider retries are made, avoiding duplicate charges. A new user-requested attempt requires a new review/key and consumes another request.

The job has one attempt and a 50-second worker timeout. Scheduler cleanup marks queued/running records older than ten minutes failed; old queued jobs also reject execution even if cleanup has not run. A crash can leave a failed or unknown provider outcome; there is no exactly-once billing guarantee. A process interruption between commit and queue dispatch is surfaced by timeout cleanup rather than silently retried. Results and request-count rows currently have no automatic retention purge; operational retention belongs to Phase 10.

## API

Verified active session and CSRF apply to mutations.

- GET /api/v1/knowledge-categories
- GET /api/v1/knowledge — search, category, tag, status, page
- GET /api/v1/knowledge/{article} — rendered content and related articles
- POST /api/v1/knowledge and PATCH /api/v1/knowledge/{article} — administrator authoring
- GET /api/v1/tickets/{ticket}/ai — requester-only paginated runs, configuration readiness and eligible diagnostics
- POST /api/v1/tickets/{ticket}/ai/preview — diagnostic_id or null; returns context and ten-minute preview token
- POST /api/v1/tickets/{ticket}/ai — token and request_key; returns queued run, HTTP 202

See [provider setup](../deployment/ai.md). Tests use controlled provider responses. No live Groq/Gemini generation was performed during implementation because no configured provider key was supplied.
