# Phase 7 — Asset management

Assets are organization-owned equipment records, separate from enrolled agent identities. Monitors, printers and other equipment can exist without an agent. An asset may link to one enrolled device; a device can belong to at most one asset. Linking does not copy or overwrite agent-reported hardware, customer identity, or device department.

## Data and lifecycle

- `assets`: UUID, unique normalized uppercase tag, name, category, manufacturer, model, serial, purchase/warranty dates, department, optional device, location, status, notes and optimistic version.
- `asset_assignments`: employee, issuing/returning operators, server timestamps and handover notes. A PostgreSQL partial unique index permits one open assignment per asset.
- `asset_events`: ordered operator/action history. Central audit records also retain edit before/after data and assignment reasons. Asset mutations and audit writes commit together.
- `installed_software`: device and hashed registry-entry identity, application name/version/publisher, optional reported install/service date, first/last detection and absence timestamp. Entries are retained when no longer detected; this is current inventory with detection history, not a full version-change ledger.

Available equipment may be assigned to an active employee. Reassignment closes the previous assignment and creates another atomically. Return closes the current assignment and sets Available, Repair, Retired, Lost or Disposed. Assigned equipment stays In Use until returned. Record a lost asset by closing its assignment with status Lost and explaining the incident in the return notes. Retirement/disposal retains the record and history; there is no destructive asset delete endpoint. Deactivated employees retain historical assignments until an operator closes them.

Every edit, assignment and return supplies the current `version`. A competing update returns HTTP 409, preserving the winning change. Tag allocation and device linking use transaction locks plus database unique constraints. Departments referenced by assets cannot be deleted.

Warranty expiration includes the specified date. Dates before today are Expired; today through 30 days ahead are Expiring; later dates are Covered; absent dates are Unknown. Warranty expiration cannot precede a known purchase date. Date calculations use the application's configured timezone. The summary excludes retired/disposed equipment from the expiring count; the register can still filter all historical records. Notifications for warranty deadlines belong to the automation phase.

## Authorization

`assets.view` permits the register, equipment details, assignment history and asset activity. `assets.manage` is additionally required for all mutations and selector options. Default IT administrators can manage; IT technicians can read. Employees and helpdesk agents do not receive asset access. Custodian user selectors expose only active account IDs/names; department selectors expose IDs/names. An asset viewer can see the linked device's basic identifier/name as part of the equipment record, but this does not grant device telemetry access.

Changing the device link requires `devices.view`. Reading software requires both `assets.view` and `devices.view`. Browser routes use the existing verified active session and CSRF middleware. Device keys never grant access to browser APIs. There are no software installation/removal commands in this phase.

## Software collection

Agent 0.7.0 reads **machine-wide** HKLM uninstall registry entries from the appropriate 32/64-bit registry views. It omits entries without a display name and entries marked as system components. It never invokes uninstall commands or `Win32_Product`, reads license secrets, or scans user files/profiles. Per-user installs, Store packages and portable apps are outside this collector's coverage.

Reports contain up to 500 applications, bounded display strings and approximately 200 KB of serialized application data, below the existing 256 KiB transport limit. Registry enumeration is capped at 2,000 keys per view. Access failures and caps make the report Partial. Source identities hash the registry view and key name; raw registry paths are not sent.

The service reports at startup and approximately every six hours; `run --once` reports software too. Existing heartbeat, diagnostic and remote-request rate limits remain unchanged. Every software report uses the existing RSA signature, nonce, timestamp, device lock and HTTPS requirements. Receipt timestamps come from the server.

Complete reports mark previously observed entries absent if not included. Partial reports update only observations actually received and never infer removal. A later observation clears absence without losing the original first-detection time. Coverage is fresh only when a complete report is less than eight hours old. “Present” is a last observation, not proof that software remains installed now. Revoked devices remain visible in historical software results and are excluded from enrolled-device coverage counts. Versions sort as text, not semantic versions.

Microsoft documents the uninstall registry fields and explains that `InstallDate` may change when a product is serviced. The UI therefore labels it **Install/service date**. Registry views are selected explicitly to capture machine-wide 32/64-bit entries. [Uninstall registry fields](https://learn.microsoft.com/en-us/windows/win32/msi/uninstall-registry-key) · [Registry views](https://learn.microsoft.com/en-us/dotnet/api/microsoft.win32.registryview)

## APIs

| Endpoint under `/api/v1` | Purpose |
| --- | --- |
| `GET /assets` | Search tag/name/serial; category/status/department/warranty filters; sorting and pagination |
| `GET /asset-statistics` | Equipment totals, availability, repair and upcoming warranties |
| `GET /asset-options?search=` | Bounded active-employee/device choices and departments |
| `POST /assets`, `PATCH /assets/{id}` | Register or edit an asset |
| `GET /assets/{id}` | Equipment and current assignment |
| `GET /assets/{id}/assignments`, `/history` | Paginated assignment and activity history |
| `POST /assets/{id}/assign` | Assign/reassign with `user_id`, `version`, `notes` |
| `POST /assets/{id}/return` | Close assignment with `status`, `version`, `notes` |
| `GET /software-inventory` | Application/publisher/device/presence filters, sorting and pagination |
| `GET /software-coverage` | Reporting coverage and collection scope |
| `POST /agent/software-inventory` | Signed, bounded `complete` + `applications` report |

Implementation is in `apps/server` models/services/controllers and the Phase 7 migration, `apps/web/src/features/assets`, and `SoftwareCollector.cs` plus the Windows worker. No extra runtime dependencies are introduced. Apply the server migration before upgrading agents. The Phase 6 live RustDesk integration remains pending; completion of asset management does not complete the remote-support MVP.
