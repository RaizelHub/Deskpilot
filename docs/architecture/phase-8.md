# Phase 8 — Automation

DeskPilot now has administrator-managed outbound webhooks, configurable in-app notification rules, a personal inbox, and a delivery inspector. Existing monitoring rules remain the single automatic-incident engine; Automation links to their settings. Email, Slack, Teams and Telegram notification actions are not implemented. Live remote control remains Phase 6 integration work.

## Events and privacy

Ticket creation, assignment, priority escalation and resolution produce immutable events inside the business transaction. Device online/offline transitions are tracked from server-observed state, and monitoring produces alert created/escalated/recovered and device warning events. Remote requested/approved/declined/cancelled/expired events describe the consent workflow only. There are deliberately no remote.started or remote.ended events while live engine integration is unavailable. No historical events are backfilled.

Payloads contain event UUID, event name, server timestamp and minimal record IDs/status/priority; ticket events also contain the ticket number. Descriptions, private notes, customer names, credentials and diagnostic output are excluded. Events associated with an audit entry are deduplicated by audit/event; delivery records are unique per receiver/event. New receiver subscriptions affect future events only.

Default notification rules cover ticket assignment/resolution and support approval requests/decisions. Administrators may configure event, recipient audience, optional exact ticket priority and enablement. Overlapping rules create at most one notification per user/event. Recipients must be active, verified and permitted to access the record. The inbox rechecks current record access on every read and mark-read action. Old notifications cannot reveal tickets after permission loss. Mark-all-read affects only accessible notifications for the current user.

## Delivery contract

POST JSON with headers `X-DeskPilot-Delivery`, `X-DeskPilot-Event`, `X-DeskPilot-Timestamp` and `X-DeskPilot-Signature`. Signature is `sha256=` followed by lowercase HMAC-SHA256 hex over the timestamp, a literal period, and the **exact request bytes**. The secret is the displayed 64-character ASCII string, not hex-decoded bytes. Receivers should enforce a five-minute timestamp window and constant-time comparison before parsing or acting on payloads.

Delivery is at least once. The delivery ID stays stable across automatic and manual retries. The event ID is in the signed body; deduplicate using the signed event ID plus the receiver identity in a durable store, not solely the unsigned delivery header. Acknowledge only after durable acceptance. Use a unique database key and transaction to protect concurrent retries. In-memory dedupe or n8n workflow static data is insufficient for business side effects.

The scheduler dispatches up to 100 due records each minute. The queue worker performs network I/O. Successful 2xx responses finish a delivery; network errors, HTTP 408/425/429 and 5xx retry after 60, 300, 900 and 3600 seconds, up to five attempts per cycle. Other HTTP responses fail without automatic retry. Retry-After is not interpreted. Operators may restart failed/cancelled deliveries using the **current** receiver configuration and original body. Attempt history and cumulative attempt count are preserved; the inspector shows the latest 100 attempts.

Workers claim records with a two-minute lease. Stalled dispatches become eligible again after three minutes. A worker crash can leave an unknown attempt and can cause a duplicate request; receivers must deduplicate. Late completion cannot revive a cancelled delivery. Saving or rotating receiver configuration cancels queued/in-progress records; an HTTP request already sent cannot be recalled. Rotating also disables the receiver. Version checks reject stale administrator edits.

## Destination and secret handling

Production accepts HTTPS port 443, public IPv4 destinations, no credentials/query/fragment and no redirects. All DNS A results are checked; a selected address is pinned for the connection. Private, loopback, link-local, reserved and multicast addresses are rejected. IPv6-only and private-LAN receivers are not supported. TLS verification remains enabled, proxy environment variables are ignored, connect timeout is three seconds, transfer timeout ten seconds, and response bodies are discarded with a 64 KiB limit. Native DNS resolution uses the host resolver timeout, outside the curl transfer timeout. Deploy workers with bounded process runtime and supervised restart.

URL and secret are encrypted at rest using Laravel's application key. Secret values are returned only on create/rotate with no-store caching; audit metadata excludes URLs/secrets and remote response bodies. Protect the application key and database backups. Receiver URLs are visible to automation administrators. No receiver is enabled by default.

`WEBHOOK_ALLOW_LOOPBACK_HTTP=true` is a development/test exception for literal `127.0.0.1` with an explicit port 1024–65535. The flag is ignored outside local/testing environments. It does not enable private networks or arbitrary HTTP destinations.

## Operations

Apply `php artisan migrate --force` after backing up the database. Migration 000009 is additive and grants automation.view/manage to existing super/IT administrator roles without resetting other permissions. PHP curl is required.

Run the existing scheduler (`php artisan schedule:work` in development, cron schedule:run in deployment) and a supervised queue worker (`php artisan queue:work --tries=1 --timeout=20`). Use a persistent queue; database or Redis is supported. Queue retry_after must exceed the worker timeout (the default 90 seconds does). `php artisan automation:dispatch` performs one dispatch pass. Dashboard timestamps show last dispatch and worker activity; an idle worker has no recent activity until a delivery is claimed. Pending records do not mean the worker is running.

Automation tables retain event bodies, notifications and attempts indefinitely in this phase. Plan retention/archiving with backups in Phase 10. This phase does not run arbitrary shell commands or remotely alter customer devices.

See [n8n receiver setup](../../infrastructure/n8n/README.md) for the inactive import template and receiver acceptance checklist.
