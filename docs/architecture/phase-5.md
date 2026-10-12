# Phase 5 — device health and incidents

Monitoring evaluates actual enrolled-device telemetry, every minute through `php artisan monitoring:evaluate` on the Laravel scheduler. Each device is evaluated within a transaction holding its row lock, shared with signed reports and revocation. Alert state, incident creation and audit writes commit together. A partial unique PostgreSQL index permits only one active alert per device, condition and resource. Repeated and overlapping evaluations do not produce duplicate incidents.

## Default rules

| Condition | Warning | Critical | Qualification |
| --- | --- | --- | --- |
| Offline | More than the configured offline interval (180s default) without a heartbeat | — | Previously reported device only; server receipt time |
| Disk usage | Above 85% | Above 95% | Fresh fixed-disk inventory; one alert per drive name |
| CPU usage | Above 90% | Above 98% | At least 300 seconds and three distinct fresh observations |
| Memory usage | Above 90% | Above 98% | Same sustained rule; calculated from available RAM and reported total RAM |

Administrators can edit thresholds, sustained duration, cooldown, enablement and automatic incident creation. Version checks reject stale edits. New breaches after a threshold edit qualify on the next fresh sample; a cached snapshot is not counted again. Offline alert timing is separate from the inventory page's online/offline display cutoff. Default cooldown is 30 minutes; all four rules start enabled with automatic incidents on. Percentage rules recover at or below warning minus five percentage points. Offline recovers on a qualifying recent heartbeat. The highest severity within an active episode is retained until recovery, while the latest measured value remains visible.

Samples are identified by server receipt timestamps. Re-evaluating the same CPU, RAM or disk snapshot cannot satisfy a sustained condition. Missing or stale values reset qualification, but never falsely recover an existing alert. Heartbeat-derived metrics expire with the device online cutoff; disk inventory is fresh for 20 minutes. Sample gaps beyond these intervals restart qualification. Agent 0.5.0 resends inventory every 15 minutes, including unchanged snapshots. Older agents remain supported, but their unchanged inventory may become unknown. Disk monitoring is snapshot-based, not a per-second live feed.

## Lifecycle and tickets

An alert moves from open to acknowledged, then recovered only when fresh readings establish recovery. Acknowledgement records the technician and time and does not suppress measurement or prevent escalation. Revoking a device or disabling a rule closes its alerts with an explicit reason; neither claims recovery. A removed drive remains an unresolved condition until fresh measurements establish recovery or monitoring is explicitly disabled.

One incident is linked to an alert. Recurrence during cooldown reopens the same alert, clears acknowledgement, increments occurrence count and reuses the incident. After cooldown, a new episode creates a new alert and incident. A still-active alert never creates a second ticket even after a technician resolves its first ticket. This prevents repeated scheduler runs from flooding the helpdesk.

System incidents use the existing atomic `INC-year-sequence` allocator and SLA targets. Requester is null and renders as **DeskPilot monitoring**; no login-capable automation account is created. Category is Network for offline, Hardware for resource usage. Priority at creation is High for critical and Medium for warning. The device department is copied for existing ticket visibility rules. Later alert severity does not overwrite a technician's ticket priority. Recovery/disable/revocation adds internal ticket history; ticket resolution, reopening and assignment remain technician decisions.

## Access and presentation

`monitoring.view` permits alert/rule/statistics reads; `monitoring.acknowledge` permits acknowledgement; `monitoring.manage` permits rule changes. Administrators receive all three. IT technicians receive read/acknowledge. Employees, department managers and helpdesk agents do not gain fleet monitoring access. Ticket links are independently filtered using ticket authorization. Device-health detail also requires `devices.view`.

The alert inbox supports status/condition/severity/device filters and pagination, acknowledgement, ticket links and rule editing. The dashboard shows active, critical, acknowledged and recovered counts. A stale scheduler banner appears after three minutes without a completed sweep. Device health is healthy only with recent evaluation and complete fresh coverage for all enabled default checks; unavailable/disabled coverage is unknown. Existing active warnings remain visible even when telemetry becomes stale. No alert means no detected condition, not proof of universal device health.

Antivirus, firewall and restart-pending checks from the broader product examples are not claimed here: the current agent does not report those signals. Notification delivery/webhooks are later automation work; Phase 5 notifications are the in-app alert inbox and dashboard. No remote control or device-changing action is introduced.

## Validation

PostgreSQL tests cover sustained distinct samples, gap resets, offline boundary, pending-device exclusion, missing/removed data, recovery hysteresis, cooldown reuse, automatic tickets, authorization, rule version conflicts and scheduler freshness. `scripts/monitoring-browser-check.mjs` uses real Windows inventory and waits for an actual heartbeat timeout in `deskpilot_browser_test`, then verifies fresh-report recovery, deduplication, system-ticket rendering and responsive UI. Run browser harnesses separately; they share the disposable database.
