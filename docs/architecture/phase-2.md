# Phase 2 implementation contract

## Goal and boundaries

A usable employee-to-technician helpdesk on the existing Laravel/React/PostgreSQL application. This phase introduces ticket lifecycle, assignment, public replies, support-only notes, private attachments, timeline, tags, queues, search/filter/sort/pagination, atomic bulk updates, real dashboard statistics and configurable wall-clock SLA targets. Device enrollment and remote control remain later phases. A reported device name is free text until Phase 3 provides enrolled-device identities.

## Database

New tables: `ticket_categories`, `sla_policies`, `ticket_sequences`, `tickets`, `tags`, `ticket_tag`, `ticket_comments`, `ticket_attachments`, `ticket_history`. UUID primary/foreign keys, indexed requester/assignee/status/priority/timestamps, restrictive user references, and transactional history. Event payloads use JSON because their shapes differ; core ticket properties and SLA targets are columns. A year-keyed sequence row is inserted conflict-safely and locked before incrementing; ticket creation and number allocation share a transaction.

## API and files

Versioned routes under `/api/v1/tickets`, ticket-scoped `/comments`, `/attachments`, `/history`, `/reopen`, plus `/ticket-options`, `/ticket-people`, `/sla-policies`, and ticket aggregates in `/dashboard`. Controllers validate inputs; `TicketService` owns lifecycle/assignment/SLA/history transactions, `TicketAccess` owns visibility, and `TicketAttachmentService` owns private file handling. React pages live under `apps/web/src/features/tickets` with separate list, create, detail, and SLA components.

## Authorization

`tickets.view` alone means own requests. `tickets.view_all` grants support-wide visibility; `tickets.view_department` grants same-department visibility only while the actor belongs to that department. Neither read scope grants write access. `tickets.create_for_others`, `tickets.assign`, `tickets.update`, `tickets.resolve`, `tickets.notes` and `tickets.reply` are independent capabilities. Employees may reply/upload to their own requests and reopen their own resolved or closed tickets. Other customers' UUIDs return 404 on every nested route. Notes, internal attachments and internal timeline rows are excluded at query time unless the actor holds `tickets.notes`. Attachment metadata never contains a storage key.

## Lifecycle and concurrency

Open → Assigned → In Progress → Waiting for User/Vendor → Resolved → Closed, with validated backwards movements for support work. Assignment/in-progress/waiting states require an active verified eligible assignee. Resolve requires resolution notes and `tickets.resolve`; Closed requires a previously resolved ticket. Reopening is a dedicated audited operation. PATCH and bulk updates require the current ticket version; stale edits return 409 and leave the record unchanged. Bulk changes are one transaction with stable row-lock order. Public replies from staff record first response; internal notes do not. Closed tickets reject new replies/uploads until reopened.

SLA targets are wall-clock minutes, not business hours. Defaults are configurable by `settings.manage`; policy updates affect new tickets and new SLA cycles only. Priority changes deliberately snapshot the current policy against the cycle's start time. Reopening starts a new cycle and preserves the previous cycle's result in history. Deadline indicators are computed from server timestamps; waiting states do not pause the timer.

## Attachments

The initial supported formats are UTF-8 `.txt`, `.png`, and `.jpg/.jpeg`, up to 5 MiB each and 20 MiB total per ticket. Text is checked for UTF-8 and NUL bytes; images are decoded with dimension limits and re-encoded to strip embedded metadata/content. Names/extensions and detected content must agree. Unsupported formats (including HTML/SVG/executables/archives/PDF) are rejected rather than served unsanitized. Files use a dedicated private disk, authenticated download responses, attachment disposition, no-store and nosniff. This is content validation/sanitization, not a malware scanner. Broader document support requires a quarantine/scanning integration first. Transaction failures clean up newly written files. Internal files stay support-only.

## Validation gates

PostgreSQL migrations and tests for ownership/department scope, cross-ticket access, internal-note/attachment isolation, assignment authorization, resolution/reopen rules, stale edits, atomic bulk failure, sequential numbers, SLA snapshots and first response, filename/type/size validation, attachment download/deletion, and dashboard scope. React tests cover field validation/error handling. A real browser scenario creates a ticket as an employee, assigns/replies/notes/resolves as a technician, checks the employee cannot see the note, verifies a private attachment round trip, and captures desktop/mobile screenshots. Cross-user updates refetch every 30 seconds and on window focus; WebSocket transport is not claimed.
