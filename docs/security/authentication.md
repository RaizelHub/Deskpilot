# Authentication and permissions

Browser requests use a same-origin session cookie: HttpOnly, SameSite=Lax, Secure in HTTPS deployments. Laravel's CSRF middleware validates `X-XSRF-TOKEN` on every state-changing web/API route. `GET /api/v1/auth/csrf` issues the CSRF cookie. The fetch wrapper decodes that cookie and never stores bearer credentials. Login regenerates the session ID; logout invalidates the session and regenerates the CSRF token.

Email/password authentication uses Laravel hashing, validation and a rate limiter keyed by normalized email and IP. Disabled users cannot authenticate or reuse an existing session. Verified email is required for administrative APIs. The current-account endpoint remains available to unverified users so they can request a new verification email. Verification links are signed, expire, require the matching account and are throttled. Forgot-password responses are generic; password reset uses Laravel's hashed, expiring broker tokens. Password reset changes the remember token, and session authentication detects password hash changes.

No public registration. The initial administrator is created using an interactive Artisan command. Development demo seeding explicitly requires a locally supplied password and refuses production execution. Account creation queues a verification email; initial credentials must be delivered through an approved channel. Logs never include passwords or reset links. Local Mailpit captures development email.

RBAC has `roles`, `permissions`, `role_user`, `permission_role`. The six role templates are Super Administrator, IT Administrator, IT Technician, Helpdesk Agent, Department Manager, Employee. Permission names follow resource/action conventions. The API checks the persisted grants on every request; frontend visibility is only a usability measure. Baseline account access is authenticated, administrative access additionally requires verification and active status.

Phase 1 permissions: `dashboard.view`, `users.view`, `users.manage`, `departments.view`, `departments.manage`, `roles.view`, `roles.manage`, `audit.view`. Future ticket/device/remote permissions are seeded as the vocabulary for later modules, not working feature claims. User-management authority alone does not permit arbitrary role assignment. Transactions lock role rows during grant and account-activation changes, protect the last active verified administrator, and write an audit event in the same transaction.

Audit endpoints are read-only. Audit rows contain actor, action, target, timestamp, IP and explicitly selected metadata. Passwords, tokens and session identifiers are excluded. Audit archival and tamper-evident external storage are hardening work; the application database administrator remains a trusted boundary.

MFA is planned, not implemented in Phase 1. Remote unattended access remains disabled. Production requires TLS, an explicit trusted-proxy policy, private Redis/PostgreSQL networking, backups, mail delivery, monitored queue workers and secret injection. Public access is not enabled by the development Compose file.

Account deactivation increments users.auth_version. Sessions retain the version from login; ActiveUser rejects a mismatch, so re-enabling an account cannot revive its older sessions. Privileged-account protection also applies while an account is disabled.
