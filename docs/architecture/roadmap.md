# Development gates

1. **Foundation (complete):** Laravel API, React/TypeScript shell, PostgreSQL, Redis, Docker, session authentication, verified email, password reset, permission-based access, users, departments, audit trail. Gate: migrations on PostgreSQL, auth/authorization tests, frontend build/typecheck/lint, CRUD workflow tests.
2. **Helpdesk (complete):** Complete ticket lifecycle, assignment, public/internal comments, private attachments, history, filtering, pagination, bulk actions, SLA fields and real ticket statistics. Gate: usable employee-to-technician workflow, ownership/internal-note tests and attachment authorization.
3. **Windows agent (complete):** Enrollment, secure device identity, heartbeat and normalized inventory; show true device state. Gate: an actual Windows PC enrolls and reports; revocation and replay tests pass.
4. **Diagnostics (complete):** Allow-listed command contracts, leases, timeout/retry and results. Gate: real diagnostics round-trip and arbitrary command rejection.
5. **Monitoring (current):** Thresholds, offline detection, recovery, deduplicated incidents. Gate: sustained condition and cooldown tests.
6. **Remote support:** RustDesk integration with visible consent, enforced mode, confirmed lifecycle, effective termination and audit. Gate: real customer/technician computers, not mock callbacks.
7. **Assets:** Inventory, assignment history, warranties and installed software.
8. **Automation:** Signed webhooks, retries, n8n and notification workflows.
9. **Optional AI:** Classification, summaries, diagnostic explanations and knowledge retrieval; no autonomous device-changing execution.
10. **Reporting/hardening:** Exports, load/security testing, backup/restore drills, retention and deployment hardening.

Do not call the whole MVP complete until phases 1–6 meet the master prompt's end-to-end device-support scenario. The implemented helpdesk uses real database records; real device metrics and diagnostics are implemented; remote-session controls remain gated. Future modules are described in the roadmap rather than presented as working buttons.
