# DeskPilot API

Laravel 13 / PHP 8.4 / PostgreSQL. See the root README and docs/deployment/README.md for setup. Run migrations and RolePermissionSeeder, then use `php artisan deskpilot:create-admin` to create the initial account interactively.

The first-party JSON API is defined in routes/web.php under /api/v1 so all state-changing browser requests use sessions and CSRF middleware. Controllers validate and authorize; services handle transactional administrative writes and audit records. No Node application backend is used.

Checks: `php artisan test` (dedicated PostgreSQL test database), `php vendor/bin/pint --test`, and `composer validate --strict`. Tests must never target application data. Current features are foundation-only; ticketing and device support follow the documented roadmap.
