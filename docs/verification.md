# DeskPilot verification

This records observed checks, not a claim that the complete DeskPilot MVP is finished.

## Phase 5 results — October 9, 2026

- Applied `2026_10_09_000006_create_monitoring_tables` and the monitoring permission seed to the existing development database without replacing records. This adds versioned rules, alert episodes, sample qualification state, sweep freshness and nullable requesters for internally created incidents.
- Full PostgreSQL regression suite passed: **46 tests / 324 assertions**. After the final incomplete-RAM coverage fix and two additional regressions, the targeted monitoring suite passed: **9 tests / 62 assertions**. Coverage includes distinct sustained samples, hysteresis, missing/stale/removed telemetry, offline boundary, pending-device exclusion, cooldown reuse, acknowledgement, revoked/disabled monitoring, automatic incidents, atomic rollback on incident failure, employee isolation and conflicting rule edits.
- Frontend ESLint, strict TypeScript/production build and **5 tests passed**. Agent 0.5.0 built with **zero warnings/errors**, and self-contained Windows x64 service/tray publishes succeeded. Inventory now resends every 15 minutes even if unchanged; the host test does not wait through a full 15-minute refresh interval.
- Scheduler registration was verified: `monitoring:evaluate` runs every minute with overlap protection. The existing local Redis endpoint was unavailable, so `schedule:list` was verified with a temporary database-cache environment override. Production configuration was not changed. Monitoring requires the scheduler and its configured cache/database services to be running.
- Final real-Windows browser acceptance run passed: signed enrollment/inventory, actual disk readings, rule editing, deduplicated automatic incidents, acknowledgement, system requester rendering, actual 180-second heartbeat expiry, fresh-report recovery with the existing incident still open, device health, revocation and employee isolation. The storage threshold was lowered only in the disposable test database, followed by a fresh inventory baseline. The app's default 85/95 thresholds remain unchanged. Repeated evaluations retained one incident per active device/drive condition.
- Inspected actual [alert inbox](screenshots/monitoring.png), [dark mode](screenshots/monitoring-dark.png), [mobile](screenshots/monitoring-mobile.png) and [automatic incident](screenshots/monitoring-incident.png) screenshots. The 390px layout has no document overflow and the final run reported no browser runtime errors. The harness uses bounded 45-second assertions for this slow local environment, revokes its temporary identity, stops its owned preview processes and deletes its temporary DPAPI directory. No persistent service or startup entry was installed.
- Scope limits: CPU/RAM sustained-condition tests use explicit synthetic test fixtures, while the browser harness uses real host storage and heartbeat readings. Antivirus/firewall/restart-pending signals and notification delivery are not implemented. Remote support remains Phase 6. Existing LocalService/reboot, code-signing, production TLS and Docker/Redis/SMTP deployment checks remain outstanding.

## Phase 4 results — October 9, 2026

- Applied additive migration `2026_10_09_000005_create_device_commands` and standard permission seed to the development database without replacing application records.
- Full PostgreSQL backend suite: **39 tests / 268 assertions passed**. Diagnostic coverage includes role/online/version boundaries, arbitrary command/argument rejection, request idempotency, repeated claim/result delivery, conflicting-result rejection, queued cancellation, revoked requester/device authorization, queue/lease expiry, one acceptance retry, no running-command replay, output bounds and cross-device isolation. JSONB field ordering exposed and resolved an idempotent-result comparison bug.
- Real Windows end-to-end test passed through the browser and signed agent queue: gateway ping (2 measurements), HTTPS Internet test (1), DNS (1), IP configuration (20), DHCP information (1), traceroute (9) and disk check (4). All seven completed on their first lease. Disk output correctly retained low-space warnings; a succeeded execution does not mean every measurement is healthy. A queued request was cancelled before the worker started.
- Inspected actual [desktop](screenshots/diagnostics.png), [dark](screenshots/diagnostics-dark.png) and [mobile](screenshots/diagnostics-mobile.png) screenshots. The 390px layout has no document overflow, and the browser reported no runtime errors. Harness: `node scripts/diagnostics-browser-check.mjs`, using only the disposable browser database, temporary encrypted identity and owned child processes. No permanent service was installed.
- .NET solution built with **zero warnings/errors**. Agent checks passed for command allowlisting, null/oversized output rejection, DPAPI pending-result persistence/clear, identity encryption, signatures and private-file ACLs. Self-contained Windows x64 service and tray publishes succeeded. The process runner enforces a 30-second deadline; a deliberately hung child-process fault was not injected in this host test.
- Frontend TypeScript/production build, ESLint and **5 tests** passed. An initial Vitest run failed because a Windows sandbox temporary transform file was unavailable; the same suite passed outside that sandbox. PHP formatting passed. Existing agent report rate limits remain unchanged; command polling is every 10–12 seconds.
- Deployment limits from Phase 3 still apply: LocalService/reboot and interactive tray behavior, code signing, fleet rollout, production TLS, and Docker/Redis/SMTP integration need deployment validation. Remote control remains Phase 6.

## Phase 3 results — October 9, 2026

- Applied migration `2026_10_09_000004_create_device_tables` to the local development database. No application records were replaced.
- Full PostgreSQL suite passed: **33 tests / 209 assertions**. After adding the device-edit/department-reference regression, the affected device and department tests passed again: **7 tests / 69 assertions** (six device scenarios plus the foundation department scenario).
- Security coverage: grant role enforcement, expiry, one-device consumption, matching-key retry, grant revocation, signature/body binding, timestamp expiry, nonce replay, unknown/revoked identity, server receipt time, online/offline transitions, inventory rollback, input bounds, employee isolation, edit conflicts and referenced-department deletion guard.
- .NET SDK **10.0.401**, pinned package versions **10.0.12**. Worker/service and tray compiled successfully with warnings treated as errors. Self-contained Windows x64 publish succeeded for both. The published service executable launches without requiring a globally installed runtime.
- Agent protocol/storage checks passed: signing and tamper rejection, HTTPS/origin rules, DPAPI roundtrip, ciphertext storage and restricted private-file ACLs.
- **Real Windows computer tested**, not seeded telemetry: enrolled this host against a loopback Laravel server, sent actual Windows/CPU/RAM/disk/network inventory, verified receipt and online state, ran the background worker through a subsequent scheduled heartbeat, revoked the identity, and confirmed the next real report was rejected.
- Browser verification passed for device enrollment, actual inventory/detail, dark mode, 390px mobile layout with no document overflow, revocation and employee API isolation. Screenshots were inspected: [devices](screenshots/devices.png), [detail](screenshots/device-detail.png), [dark](screenshots/device-dark.png), [mobile](screenshots/device-mobile.png).
- TypeScript/production build, ESLint and all 5 frontend tests passed. PHP Pint and Composer strict validation also passed. The test harness uses only the disposable `deskpilot_browser_test` database and removes its temporary DPAPI key directory and child processes. Test enrollments are revoked. No permanent Windows service or startup entry was installed.
- Deployment limits: LocalService installation/reboot behavior and interactive tray behavior have not been exercised. Binaries are unsigned. Production HTTPS, code signing, fleet rollout, and the existing Docker/Redis/SMTP limits below remain deployment validation work. The actual console/background-worker test does not claim those additional checks.

## Phase 2 results — October 9, 2026

- Applied the helpdesk migration and role permissions to the local development PostgreSQL database without replacing existing records.
- Backend suite: **28 tests / 155 assertions passed**. Seven helpdesk scenarios cover unique ticket numbers, ownership/department visibility, mutation authorization, valid assignees, stale versions, resolution/close/reopen transitions, internal notes, public-response SLA behavior, private attachments, malformed file rejection, authenticated download/deletion, atomic bulk rollback, scoped dashboard statistics and configurable SLA deadlines.
- Fixed a PostgreSQL session timezone mismatch uncovered by the SLA test. Connections now use UTC.
- Frontend: **5 tests passed**; strict TypeScript/production build, ESLint, PHP Pint and Composer strict validation passed. Composer reported no dependency advisories.
- Headless Edge workflow passed on the dedicated PostgreSQL browser database: employee creates a categorized/tagged ticket and uploads text; technician assigns, adds an internal note, replies and resolves; employee cannot see the note, downloads the original attachment and reopens. Existing foundation workflows also passed.
- Inspected real screenshots: [ticket detail](screenshots/ticket-detail.png), [queue](screenshots/tickets.png), [dashboard](screenshots/helpdesk-dashboard.png), [mobile](screenshots/ticket-mobile.png). The 390px ticket layout has no horizontal document overflow.
- Workflow drafts retain their starting version across background refreshes. Editor submissions use the version captured when the editor opened, preserving conflict detection.
- Attachments support TXT/PNG/JPEG with private storage and image re-encoding. PDF/Office documents are not enabled; no malware-scanning service is claimed.

## Foundation results

- Installed dependency locks: Laravel 13.35.0 / PHP 8.4.24, React 19.3.0, Vite 8.3.3, TypeScript 6.0.3, PostgreSQL 18.6.
- Laravel migrations and permission seeding ran on a real, isolated PostgreSQL 18.6 cluster bound to localhost. Application and test databases are separate.
- Backend suite: 21 tests / 77 assertions passed on PostgreSQL, covering login/logout, throttling, role enforcement, unverified/inactive accounts, account creation and password hashing, validation, privilege escalation, inactive administrator protection, last-administrator protection, search/pagination, department deletion, atomic bulk updates, revocation across reactivation, password broker tokens, signed verification links, current-password checks, and CSRF middleware.
- Frontend tests: 5 passed, covering login validation, HTTP/API errors, password recovery confirmation, CSRF headers and permission failures.
- Strict TypeScript compilation, production Vite build, ESLint and Laravel Pint passed. PHP syntax checks passed for all 51 checked source/config/migration/test files, and Composer strict validation passed.
- Headless Edge browser workflows passed against PostgreSQL: login, department creation, user creation/search/deactivation, light/dark theme, 390px mobile layout without document overflow, logout and employee authorization. Screenshots were inspected for desktop, dark and mobile layouts. The harness shuts down its browser and preview processes on success and failure.
- Compose configuration parses successfully with generated local secrets. npm and Composer reported no dependency security advisories during installation.

## Environment limits

Docker Desktop could not start its Linux engine: its backend reported an inaccessible `sailor-ingest.sock`. No Docker reset, volume deletion or unrelated system repair was performed. PostgreSQL checks used the official EDB portable Windows distribution linked from PostgreSQL's download page. The runtime lives in ignored `.local-tools/`.

The full Compose image build/start, Redis-backed sessions/worker and SMTP delivery remain unverified in this environment. Browser checks use PostgreSQL-backed session/cache/queue drivers in their isolated test profile. Production and Compose configuration remain Redis-based. Notification classes are tested with Laravel notification fakes; a running SMTP server/queue worker is still required for delivery.

The real Windows agent and telemetry are now verified as described in Phase 3 above. Diagnostic execution is verified under Phase 4. RustDesk connections and AI remain later phases. The helpdesk workflow remains verified under Phase 2. Public hosting was not attempted for the Laravel application.


## Phase 6 approval workflow — 2026-10-10

- Backend regression: **54 tests / 398 assertions passed** on isolated PostgreSQL, including customer binding, technician self-approval denial, control-to-view downgrade, upgrade rejection, idempotency, duplicate pending requests, expiry, revocation, role loss, privacy and input tampering.
- Frontend: **5 tests passed**; final ESLint and TypeScript/Vite production build passed after correcting the expiry timer.
- Windows agent 0.6.0: solution build passed with zero warnings/errors; signature, DPAPI, ACL and diagnostic boundary checks passed. Self-contained win-x64 service and tray published successfully.
- The final real-agent browser check passed signed notification polling, customer consent, downgrade, withdrawal, decline, audit history, employee isolation and responsive layouts. Desktop, dark and mobile screenshots were refreshed; the mobile layout has no document overflow.
- The additive Phase 6 migration was applied to the local application database without resetting existing data. Browser fixtures use only deskpilot_browser_test.
- Optional RustDesk Compose configuration parses with a validation-only image placeholder. No image was pulled or deployed; a verified immutable image reference remains required.
- Live RustDesk transport, two-device mode enforcement, native tray interaction, active-sharing indicator and effective transport disconnect are **not implemented/verified**. Phase 6 acceptance remains incomplete; see [integration requirements](remote-support/README.md).


## Phase 7 asset management — 2026-10-10

- Full backend regression: **64 tests / 490 assertions passed** on isolated PostgreSQL. New coverage includes asset tag uniqueness, version conflicts, assignment/reassignment/return, inactive assignees, retained history, audit-failure rollback, device-link uniqueness/permissions, department retention and warranty boundaries.
- Signed software-report tests verify version updates, preserved first detection, removal/reappearance, partial-report preservation, atomic validation, replay rejection, revoked/wrong device denial, search/sort, coverage freshness and role restrictions.
- Frontend ESLint, strict TypeScript/production build and **5 component tests passed**. Critical asset workflows are covered by the browser harness.
- Agent 0.7.0 solution built with **zero warnings/errors**. Security checks and actual Windows software-report count/size/identity checks passed. Self-contained Windows x64 service and tray published successfully; they remain unsigned and were not installed as system services.
- Real Windows/browser validation detected **67 machine-wide applications** and exercised asset creation, enrollment linking, assignment, reassignment, return, preserved handover history, warranty filtering, editing, application search, technician read-only access and employee denial. No mocked software rows were used. Browser tests use only deskpilot_browser_test and clean up their processes/temporary device identity.
- The Phase 7 additive migration was applied to the local application database without resetting existing data. Existing asset permissions needed no role reseeding.
- Collection deliberately excludes per-user, Store and portable apps. Six-hour periodic rescan scheduling is implemented; the browser test verifies startup/run-once collection rather than waiting six hours. Partial reports never infer absence. Inventory is an observation, not a live installation guarantee.
- Phase 6 live RustDesk integration remains incomplete. Phase 7 does not enable remote transport or unattended access.

Final Phase 7 browser rerun passed after the mobile heading adjustment. Desktop, dark and 390px mobile screenshots were refreshed and visually inspected; the mobile document has no horizontal overflow (wide tables scroll within their panels). Phase 7 PHP files passed Pint.

## Phase 8 — 2026-10-10

- Backend: 72 tests / 595 assertions passed against isolated PostgreSQL. Includes eight automation tests covering encrypted secret storage, authorization, configuration cancellation/version conflicts, exact HMAC payloads, five-attempt backoff, duplicate dispatch suppression, terminal/manual retry, destination restrictions, notification access after role loss, rule validation and transactional outbox rollback. Existing ticket, agent, diagnostics, monitoring, remote consent and asset suites passed.
- Frontend: type checking, ESLint, production build and five existing component tests passed. The first sandboxed Vitest run hit a temporary-file mapping error; running with normal local temp access passed.
- `node scripts/automation-browser-check.mjs`: passed against disposable deskpilot_browser_test. Real database queue worker sent HTTP requests to literal loopback receiver; HMAC verified, 400 recorded, manual retry succeeded with stable delivery ID. Created notification rule, customer ticket, visible inbox update and mark-all-read; employee automation access denied. No external endpoint contacted.
- Desktop, dark and 390px mobile screenshots inspected; no horizontal document overflow. Artifacts: screenshots/automation.png, automation-dark.png, automation-mobile.png and notifications.png.
- `node scripts/n8n-verifier-check.mjs`: actual template Code node source passed valid/invalid signature, modified payload, stale timestamp, event mismatch and absent-secret checks using helper stubs. Live n8n import/execution was not available and remains a deployment acceptance step.
- Additive migration 000009 applied to the local application database, preserving existing data. No application demo seed/reset performed. Temporary browser/PHP/Vite/receiver processes closed; local PostgreSQL stopped after verification.
- Phase 6 live RustDesk control remains integration-pending. No fabricated remote start/end events or automated device commands introduced.

## Phase 9 — 2026-10-11

- Backend: **85 tests / 716 assertions passed** in the final full PostgreSQL suite. Thirteen new tests cover knowledge visibility/search/tags/version conflicts, Markdown sanitization, credential redaction, persistent-queue readiness, disabled AI, preview binding/staleness, private encrypted results, Groq and Gemini request/response mappings, refusals, unsupported commands/invented references, permission loss, source archival, request deduplication/quota, sanitized errors, expiry and diagnostic-ticket binding. Existing 72 tests remain passing.
- Frontend: TypeScript, ESLint, production build and five existing component tests passed.
- Browser: `node scripts/ai-browser-check.mjs` passed with a disposable PostgreSQL database, real session/CSRF/API flow and real queue worker. It checks knowledge create/edit/search/render, employee visibility, exact context review and credential redaction, completed analysis/citations, unchanged ticket fields, and responsive light/dark/mobile layouts. The provider response is an explicit guarded fixture, not live generation. Final screenshots were inspected.
- Screenshots: knowledge-base.png, knowledge-article.png, ai-context-preview.png, ai-ticket-fixture.png, ai-ticket-dark-fixture.png and ai-ticket-mobile-fixture.png under docs/screenshots. AI result screenshots visibly identify fixture output.
- Migration 000010 applied additively to the existing local DeskPilot database; no application reset or demo seed was performed. Temporary browser, Vite, PHP preview and fixture worker processes exited. PostgreSQL was already available when this continuation resumed and remains running.
- Groq/Gemini live credentials were not configured or called. Provider HTTP contracts are verified with fakes; account/model compatibility and live response quality remain deployment acceptance checks. AI stays off by default. No automatic ticket changes, diagnostic execution, external notifications or remote sessions were triggered by AI.
- Fixed during verification: model-ID validation formatting, separate preview/generation throttle keys, independent provider fakes, common credential redaction formats and test helper/import conflicts. Earlier approval-review usage-limit interruption was resolved on continuation.

## October 13, 2026 — typography and navigation redesign

- Replaced Lucide UI icons with text-led controls throughout the frontend. Icon-size actions retain visible labels; close and password visibility controls use words.
- Added a warm neutral / muted green theme with Segoe UI Variable / Segoe UI body typography and Georgia display headings. Uses local system fonts without third-party font requests.
- Rebuilt permission-filtered navigation with shorter labels, scrollable groups, and a compact mode that keeps labels visible. Mobile drawer includes Close, Escape dismissal and a labeled Menu trigger.
- Simplified the header, login presentation, shared controls, panels and dashboard. Removed unsupported connected/production-ready and security marketing claims from the shell/login.
- Validation: frontend lint, TypeScript/production build, and all five existing frontend tests passed. The isolated `scripts/redesign-browser-check.mjs` uses intercepted fixture responses (not live backend data) to exercise desktop, compact navigation, themes, command search, mobile overflow, Escape dismissal and password visibility. Screenshots are named `redesign-*-fixture.png` in `docs/screenshots`.
- Temporary preview closes after verification. DeskPilot Docker services remain stopped as requested; the redesign has not been deployed to those containers.
