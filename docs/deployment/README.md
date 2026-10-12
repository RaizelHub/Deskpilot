# Local setup and deployment

## Requirements

Docker Desktop with a running Linux engine and Compose, Node 24+ for optional native frontend development, PHP 8.4 with Composer for native backend development. The Docker build supplies PHP and extensions. A blank `.env.example` is intentional; secrets are generated locally.

## Docker workflow

From the repository root:

```powershell
node scripts/setup-env.mjs
docker compose up -d --build
docker compose exec api php artisan migrate --seed --force
docker compose exec api php artisan deskpilot:create-admin
```

The final command interactively requests the administrator's name, email and password, without logging the password. Open `http://localhost:8080`; development email is captured at `http://localhost:8025`. The queue worker processes verification and password-reset notifications. No hardcoded account passwords are shipped.

Compose services: Nginx/React, PHP-FPM API, Redis, PostgreSQL 18, queue worker, scheduler and Mailpit. Database/Redis/Mailpit exposed ports bind to localhost only. Persistent volumes store PostgreSQL, Redis and private application files. Do not use `docker compose down -v` unless you intend to erase that deployment's data.

## Native development with container infrastructure

```powershell
npm ci
composer install --working-dir=apps/server
node scripts/setup-env.mjs
docker compose up -d postgres redis mailpit
```

Set `apps/server/.env` using its `.env.example`: DB host `127.0.0.1`, port `54329`, database/user/password matching the root `.env`; Redis port `63799`, client `predis`; SMTP port `10259`. Set both APP_URL and FRONTEND_URL to the browser origin (`http://localhost:5173`). Generate APP_KEY if unset. The setup helper preserves existing env files, so a pre-existing Laravel scaffold env may need explicit updating.

Run `php artisan migrate --seed` and `php artisan deskpilot:create-admin` from `apps/server`. In separate terminals:

```powershell
composer run dev --working-dir=apps/server
npm start
```

Also run `php artisan queue:work --tries=3` in `apps/server` for email. Vite proxies `/api` to Laravel port 8000, preserving the browser host. Do not mix `localhost` and `127.0.0.1` in email verification links or browser sessions.

## Tests

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Backend tests use a **separate** PostgreSQL database named `deskpilot_test`; create it before `php artisan test`. The test role needs table creation privileges. Never point tests at a database with user data: RefreshDatabase runs migrations and resets test state. PHPUnit uses array sessions/cache and synchronous fake notifications to isolate external infrastructure.

The browser harness `node scripts/browser-check.mjs` requires a separate PostgreSQL database named `deskpilot_browser_test`, PHP, and installed Microsoft Edge (or `BROWSER_CHANNEL=chrome`). It **recreates only that explicitly named test database's schema**, seeds random ephemeral account passwords in process memory, starts loopback API/Vite servers, runs the workflows, captures screenshots, and closes its browser/servers. Its PostgreSQL session/cache/queue drivers are a test profile, not the shipped Redis configuration. Re-run backend tests after browser work if sharing other test infrastructure.

## Production preparation

Compose is a local development topology, not a hardened production manifest. Before deploying: use APP_ENV=production, APP_DEBUG=false, HTTPS at a trusted edge, APP_URL/FRONTEND_URL matching the public origin, SESSION_SECURE_COOKIE=true, a configured trusted proxy policy, private database/Redis services, protected secret injection, a real SMTP provider, automated backups and restore verification, supervised workers, resource limits and log monitoring. Replace mutable image tags with tested pinned digests and build production PHP dependencies with `--no-dev` after tests. Do not seed demo accounts in production. Review the security model and phase acceptance gates.

## Troubleshooting

- Docker cannot find `dockerDesktopLinuxEngine`: start Docker Desktop and inspect its startup error. During this build Docker reported an inaccessible local `sailor-ingest.sock` and never provided the engine. The source does not reset Docker or erase its data.
- PostgreSQL connection refused: check port mapping, DB credentials and whether the database exists.
- PHP cannot use Redis natively: use the installed Predis client (`REDIS_CLIENT=predis`) and the correct mapped port.
- Login returns 419: refresh the CSRF cookie and submit again; use the same hostname throughout.
- Verification URL rejected: match FRONTEND_URL and APP_URL to the browser origin, request a fresh email and sign in as the recipient.
- Email not arriving locally: ensure worker and Mailpit are running; inspect failed jobs without logging reset tokens.
- User cannot access a page: check active state, verified email and assigned permission templates.

Back up PostgreSQL using `pg_dump` with credentials supplied through protected environment/service configuration, retain encrypted off-host copies, and rehearse restoring into a separate database. Never copy live database files as a substitute for a supported backup. Retention and scheduled backups are Phase 10 implementation work.

## Monitoring runtime (Phase 5)

Apply migrations and the role permission seed before running agent 0.5.0. Keep the scheduler process running (`php artisan schedule:work` locally; Compose has a scheduler service). It invokes `monitoring:evaluate` every minute. Verify with `php artisan schedule:list`; this reads the configured cache backend, which must be available. A failed/incomplete sweep leaves the previous completed timestamp and the UI shows overdue monitoring after three minutes. Run `php artisan monitoring:evaluate` for a one-off operator check.

All four rules initially enable automatic ticket creation. Review their thresholds and cooldown in **Alerts → Monitoring rules** before fleet rollout. System-generated tickets have a nullable requester; normal human ticket creation still requires an active requester. Upgrade the Windows agent to 0.5.0 so unchanged inventory snapshots refresh every 15 minutes.

## Phase 6 approval workflow

Apply migrations before upgrading the Windows service/tray to 0.6.0. Keep `schedule:work` running to expire and reconcile requests every minute. This release enables approval records and notifications only; live connections remain disabled. The optional RustDesk infrastructure template is separate and has not been deployed. See [integration requirements](../remote-support/README.md).

## Phase 7 asset management

Apply `php artisan migrate --force` before deploying agent 0.7.0. Existing `assets.view` and `assets.manage` permissions require no new seed or role reset. Upgrade both service and tray from their complete published directories. Software reports require the Phase 7 endpoint and tables; old agents still report hardware but have no software coverage. Asset changes retain history and the migration does not reset existing data. [Lifecycle, API and inventory scope](../architecture/phase-7.md).

## Phase 8 automation

Apply migration 000009 with `php artisan migrate --force`. Existing IT/super administrator roles receive automation permissions; do not reset role assignments. Ensure PHP curl is enabled. Run the scheduler and a supervised queue worker (`php artisan queue:work --tries=1 --timeout=60`) with a persistent queue and retry_after greater than the worker timeout. The local browser harness uses the database queue. No external receivers are seeded or enabled. Configure one in Automation, save the one-time secret in the receiver, enable it, and send a test. See [delivery contract and operations](../architecture/phase-8.md) and [n8n setup](../../infrastructure/n8n/README.md).

## Phase 9 optional AI

Apply migration 000010 for knowledge articles and AI run history. AI stays disabled unless explicitly configured. Choose Groq or Gemini, set the key/model on the server, and use a persistent queue with a supervised worker. [Setup, model compatibility and live acceptance steps](ai.md). Employee knowledge access is limited to published Everyone articles; AI runs require ai.use and current ticket access.
