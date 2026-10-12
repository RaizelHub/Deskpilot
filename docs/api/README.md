# DeskPilot API

Base `/api/v1`, JSON responses, same-origin cookie authentication. Fetch `/auth/csrf` before login or other mutations and send decoded `XSRF-TOKEN` cookie as `X-XSRF-TOKEN`. Requests use `Accept: application/json`. Laravel validation errors return 422 with `message` and `errors`; unauthenticated 401, unauthorized/unverified 403, CSRF failure 419, throttled 429.

| Method | Path | Access / behavior |
| --- | --- | --- |
| GET | `/auth/csrf` | Anonymous; initializes session/CSRF cookies |
| POST | `/auth/login` | Email/password, rate-limited; regenerates session |
| GET | `/auth/me` | Active authenticated user and current permission names |
| POST | `/auth/logout` | Invalidates current session |
| POST | `/auth/forgot-password` | Neutral confirmation; queues reset notification |
| POST | `/auth/reset-password` | Email, token, password, password_confirmation |
| POST | `/auth/password` | Current password plus confirmed new password; other sessions invalidated |
| POST | `/auth/verification-notification` | Queues signed verification notification |
| GET | `/auth/verify-email/{uuid}/{hash}` | Signed URL; authenticated matching user only |
| GET | `/dashboard` | `dashboard.view`; returns only authorized aggregates |
| GET | `/users` | `users.view`; search, active, sort, direction, page, per_page |
| POST | `/users` | `users.manage`; creates unverified account, queues email |
| PATCH | `/users/{uuid}` | `users.manage`; profile, department, roles, active status |
| POST | `/users/bulk-status` | `users.manage`; up to 100 UUIDs and is_active; atomic |
| GET | `/roles` | `roles.view`; six templates and permission names |
| GET | `/departments` | `departments.view`; search, page, per_page |
| POST | `/departments` | `departments.manage`; unique name and description |
| PATCH | `/departments/{uuid}` | `departments.manage` |
| DELETE | `/departments/{uuid}` | `departments.manage`; rejects assigned users |
| GET | `/audit-logs` | `audit.view`; action search, page |

All workspace routes require an active verified account. Password/verification routes permit unverified authenticated accounts. Page size is capped at 100 (audit at 20). Sorting is allow-listed. User resources exclude password hashes and remember tokens. Role grants are separately constrained by `roles.manage` and the actor's existing permissions. Existing initial administrator verification is an explicit console trust boundary.

User create/update shape:

```json
{
  "name": "Maria Santos",
  "email": "maria@example.test",
  "department_id": null,
  "is_active": true,
  "role_ids": ["role-uuid-returned-by-roles-endpoint"]
}
```

Creation additionally requires a password of at least 12 characters with letters and numbers. Updates prohibit password changes through the user-management endpoint; password broker/account endpoints handle those operations. Emails are normalized to lowercase. Email changes clear verification.

No ticket, device or remote session endpoint is implemented in Phase 1. Those contracts are documented in the architecture and agent plans.


## Helpdesk

All endpoints require an active, verified session and `tickets.view`. Visibility is enforced on the parent ticket for every nested request. Employees see their requests; department managers also see their department; support roles have `tickets.view_all`. Inaccessible IDs return 404. Internal notes, internal attachment metadata/downloads, and their history entries require `tickets.notes`.

| Method | Path | Behavior |
| --- | --- | --- |
| GET / POST | `/tickets` | Paginated scoped list / create (`tickets.create`) |
| GET / PATCH | `/tickets/{uuid}` | Detail / authorized field changes with required `version` |
| POST | `/tickets/bulk` | Atomic list of up to 50 `{id, version}` items and `changes` (status, priority, assignee, resolution notes) |
| POST | `/tickets/{uuid}/reopen` | Requester or support; `version`, `reason`; starts a fresh SLA cycle |
| GET / POST | `/tickets/{uuid}/comments` | Paginated conversation / `{body, is_internal}` |
| GET | `/tickets/{uuid}/history` | Paginated newest-first history, filtered for internal visibility |
| GET / POST | `/tickets/{uuid}/attachments` | Visible attachments / multipart `file`, optional `is_internal` |
| GET / DELETE | `/tickets/{uuid}/attachments/{uuid}` | Authenticated attachment download / uploader or ticket editor deletion |
| GET | `/ticket-options` | Categories, priorities, statuses |
| GET | `/ticket-people` | `kind=requester|assignee`, `search`, `page`; permission-scoped selector |
| GET / PUT | `/sla-policies` | `settings.manage`; four policies with priority, response_minutes, resolution_minutes |

List parameters: `search`, `status`, `priority`, `category_id`, `assignee_id`, `tag`, `queue=all|mine|assigned|unassigned|overdue`, `sort=created_at|updated_at|title|number|priority|resolution_due_at`, `direction`, `page`, `per_page` (max 100).

Creation requires title (3–160), description (5–15000), category UUID, and priority. Optional fields are reported_device (100), tags (up to ten lowercase alphanumeric/hyphen labels), requester_id (create-for-others permission) and assignee_id (assignment permission). Assignment requires an active verified support user. Editing uses optimistic versions; stale versions return 409 and bulk changes roll back together. Resolving requires resolution notes; closing requires resolved status; reopening is a separate action.

Files: UTF-8 TXT, decoded/re-encoded PNG/JPEG, max 5 MiB each, 20 files and 20 MiB per ticket. Downloads force attachment disposition with nosniff and no-store. No public storage URL is issued. Local PHP must enable GD/fileinfo and allow multipart bodies of at least 6 MiB. Container limits are configured. Broader document formats are deferred pending scanning integration.

Dashboard adds scoped `tickets` counts, seven-day volume, category/priority breakdowns, recent tickets and average resolution minutes. Dates and daily aggregates use UTC, displayed in the browser's local timezone. Waiting states do not pause SLA clocks. Support public replies and resolutions satisfy first response; private notes do not. Polling refreshes the UI every 30 seconds and on window focus.


## Devices and enrollment

| Method | Path | Authorization / behavior |
| --- | --- | --- |
| GET | `/devices` | `devices.view`; search, state (online/offline/pending/revoked), department_id, page; 15 per page |
| GET | `/device-statistics` | `devices.view`; totals and offline threshold |
| GET | `/devices/{uuid}` | `devices.view`; actual hardware, disk and network snapshots; no private credential material |
| PATCH | `/devices/{uuid}` | `devices.manage`; name, department_id, version; 409 on stale details |
| POST | `/devices/{uuid}/revoke` | `devices.manage`; reason; revokes signatures while retaining inventory/history |
| GET / POST | `/enrollment-grants` | `devices.manage`; list / create label, optional department_id, expires_minutes (5–1440); plaintext token returned once |
| DELETE | `/enrollment-grants/{uuid}` | `devices.manage`; revoke enrollment grant, not an already enrolled device |
| POST | `/agent/enroll` | Stateless HTTPS; token, public_key (RSA 3072–4096), hostname, agent_version; grants hashed/locked and single-device |
| POST | `/agent/heartbeat` | Signed device identity; agent_version, nullable cpu_percent/ram_available_bytes/network_connected, uptime_seconds |
| POST | `/agent/inventory` | Signed device identity; hostname, hardware, disks[], interfaces[]; normalized atomic replacement |

Agent JSON bodies are capped at 256 KiB, with bounded arrays/strings. Invalid identity/signature/stale clock returns 401; replay returns 409; transport rejection returns 403; malformed reports return 422. Revocation and report writes use the same device row lock. Heartbeat updates current state and last_seen_at using server time. Inventory receipt does not fake a heartbeat. Neither endpoint grants browser session privileges.

See [the exact signature format and Windows setup](../agent/communication.md). The scheduler prunes replay nonces after ten minutes. Online/offline is computed from last_seen_at; telemetry is measured and the Phase 4 diagnostic queue is described below. Remote control remains Phase 6.

## Diagnostics (Phase 4)

Browser endpoints require verified, active users with both `devices.view` and `devices.diagnostics`. Requests require an online device reporting agent version 0.4.0 or later. The catalog is fixed; command arguments, arbitrary hosts, paths, scripts and shell input are rejected.

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/diagnostic-catalog` | Seven approved command IDs, names and descriptions |
| GET | `/devices/{uuid}/diagnostics` | Ten records per page, newest first; requester, lifecycle, reason and structured results; no lease/request keys |
| POST | `/devices/{uuid}/diagnostics` | `command`, `reason` (3–500 characters), `request_key` UUID, optional visible `ticket_id`; 201, retry with identical key/payload is idempotent; max ten pending per device |
| POST | `/devices/{uuid}/diagnostics/{command}/cancel` | Cancel requested/accepted work; 409 once running or terminal |
| POST | `/agent/commands/claim` | Signed empty JSON object; `data: null` or `{id, command, lease_id, lease_expires_at, timeout_seconds: 30}` |
| POST | `/agent/commands/{uuid}/start` | Signed `{lease_id}`; response status `running` or `rejected` after requester authorization recheck |
| POST | `/agent/commands/{uuid}/result` | Signed `lease_id`, `status` (succeeded/failed/rejected), `summary`, `duration_ms`, `checks[]`; each check has name/status/detail/optional duration_ms |

Agent command routes use the same signatures, nonce replay checks, revocation locks and existing 30 requests/minute device/IP limit as reports. Polling every 10–12 seconds stays within this limit. Command results are capped at 64 KiB and 64 checks (detail at most 2,000 characters). Check statuses are pass/fail/warning/info. Expired or mismatched leases return 409; another device's command returns 404. Identical terminal result retries succeed; conflicting replacements return 409. PostgreSQL JSON object key ordering does not affect result equivalence.

Queue TTL is five minutes. Acceptance/execution leases are 90 seconds. One unstarted delivery retry is allowed; running work is never automatically executed again. The scheduler expires abandoned work every minute; list/claim paths also reconcile expiry. See [Phase 4 lifecycle and limitations](../architecture/phase-4.md).

## Monitoring (Phase 5)

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/alerts` | `monitoring.view`; filters status (active default, open, acknowledged, recovered, closed, all), kind (offline/disk/cpu/memory), severity, device_id; page, 15 records/page |
| GET | `/monitoring-statistics` | `monitoring.view`; active/critical/acknowledged/recovered_today counts, evaluated_at and server-calculated stale flag |
| GET | `/devices/{uuid}/health` | `monitoring.view` + `devices.view`; healthy/warning/critical/unknown/unmonitored, evaluation/inventory timestamps, active count |
| POST | `/alerts/{uuid}/acknowledge` | `monitoring.view` + `monitoring.acknowledge`; idempotent for acknowledged alerts, 409 if recovered/closed |
| GET | `/alert-rules` | `monitoring.view`; four fixed rules and versions |
| PUT | `/alert-rules/{kind}` | `monitoring.view` + `monitoring.manage`; enabled, auto_incident, warning, critical (omit for offline), sustain_seconds, cooldown_seconds, version; stale version returns 409 |

Percentage warning range 10–98, critical above warning and at most 100. Offline warning is 120–86,400 seconds, with sustain_seconds fixed at zero and no critical field. Other sustained durations are 0–3,600 seconds. Cooldown is 60–86,400 seconds. Rule updates are audited and take effect at the next evaluation. There is no browser endpoint for injecting samples, forcing evaluation, or marking a measured condition recovered.

Alert responses include device identity, measured summary/value/time, acknowledgement identity/time, recurrence count and closure reason. Ticket links are returned only if visible under existing ticket authorization. Automated incidents have null requester and a system history actor; normal ticket creation still requires a real active requester. Read endpoints do not execute the monitor. Run the Laravel scheduler; `monitoring:evaluate` is also available to administrators at the server CLI. See [Phase 5 semantics](../architecture/phase-5.md).
