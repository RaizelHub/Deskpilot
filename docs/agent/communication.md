# Windows agent setup and protocol

Phases 3–5 implement enrollment, independent device identity, scheduled heartbeat, real Windows inventory and seven fixed read-only diagnostics. Customer-approved RustDesk support remains Phase 6. There is no arbitrary command execution or unattended-control switch.

## Install and enroll

1. Deploy Laravel behind a valid HTTPS endpoint. Apply migrations and run the Laravel scheduler. Devices need outbound HTTPS only. Configure reverse-proxy trust explicitly if TLS terminates before PHP; never trust arbitrary forwarded headers from the internet. Pass the agent signature headers and raw request body unchanged.
2. Build/publish following [the agent README](../../apps/agent/README.md). Copy the complete `publish/service` and optional `publish/tray` directories to the customer computer.
3. An administrator opens **Devices → Enroll device**, names the computer and creates a one-use grant. Grants expire (15 minutes by default, at most 24 hours), can be revoked, and are shown only once. Matching-key enrollment retries are idempotent while the grant remains valid.
4. Run `apps/agent/install-service.ps1 -PublishDirectory <full service publish path>` in elevated PowerShell. It copies files into `%ProgramFiles%\DeskPilot\Agent`, registers `DeskPilotAgent` as **LocalService**, and does not start it yet. It refuses to overwrite an existing installation.
5. From elevated PowerShell, enroll using the installed executable:

```powershell
& "$env:ProgramFiles\DeskPilot\Agent\DeskPilot.Agent.Service.exe" enroll --server https://deskpilot.example.com
Start-Service DeskPilotAgent
```

Paste the grant at the hidden prompt. For deployment automation, supply it through standard input; never put it in command arguments or a checked-in script. The server address must be an origin without a path, query, fragment or embedded credentials. The private key stays on the device.

Run `DeskPilot.Agent.Tray.exe` in the interactive user's session for visible status, device information and **Open support**. The tray reads only the non-secret local status file. It does not start a privileged service or expose a command pipe. Closing the tray leaves the service running. Tray startup registration is an explicit deployment decision.

A temporary foreground run uses `DeskPilot.Agent.Service.exe run`; `run --once` sends one heartbeat and inventory snapshot and exits. `status` prints non-secret local state. A custom `--data-dir` supports isolated tests. Only one agent process may hold a data directory at a time.

## Identity and transport

Devices generate 3072-bit RSA keys. The server stores only public keys/fingerprints. Private PKCS#8 material is protected with machine-scoped Windows DPAPI in `%ProgramData%\DeskPilot\identity.dpapi`; private-file inheritance is disabled and access is limited to SYSTEM, administrators, LocalService and the enrolling identity. The parent directory allows ordinary users read access for non-secret `status.json`, not the protected identity file. Local administrators remain trusted; DPAPI is not protection against a compromised administrator.

Agent endpoints are stateless; browser cookies and CSRF tokens do not authenticate reports. All reports are POST JSON with these headers:

```text
X-Device-Id: device UUID
X-Agent-Time: Unix UTC seconds
X-Agent-Nonce: new UUID for each request
X-Agent-Signature: base64 RSA-SHA256 PKCS#1 v1.5 signature
```

The UTF-8 canonical string contains seven lines, without a trailing newline:

```text
v1
POST
/api/v1/agent/heartbeat
device UUID
Unix UTC seconds
nonce UUID
lowercase SHA256 of the exact request body
```

Inventory and command lifecycle requests substitute their exact `/api/v1/agent/...` route. Query parameters are rejected. A five-minute clock window requires synchronized device clocks. Unique device/nonce records reject replay. The scheduler prunes nonces after ten minutes; old signed timestamps cannot become valid after pruning. Reports and credential revocation serialize on the device row.

HTTPS is mandatory. Isolated testing may explicitly set `AGENT_ALLOW_LOOPBACK_HTTP=true` on a local/testing server and pass `--allow-loopback-http` at enrollment. Request host and source must both be loopback. Production ignores this exception. TLS certificate validation and redirects are never bypassed.

## Reporting and storage

CPU utilization, available RAM, uptime, network availability and agent version report approximately every 60–80 seconds while idle. A running diagnostic can defer the next report by up to 30 seconds. Agent 0.5.0 sends inventory every 15 minutes, including unchanged snapshots, and after worker startup. This keeps monitoring freshness meaningful. Unknown values remain null. Disks/adapters are bounded at 64 each, address lists at 32. Disk space and network addresses are inventory snapshots. Hardware currently reports the first processor/GPU returned by WMI; multi-socket/GPU expansion needs a future schema change.

Online status uses server receipt time. `AGENT_OFFLINE_SECONDS` defaults to 180 (minimum 120). Pending means enrolled without a heartbeat; offline means the last heartbeat is stale; revoked is separate. Metrics are overwritten current-state columns, not unbounded history. Invalid inventory cannot partially replace existing rows.

Transient failures retry with exponential backoff, capped at approximately five minutes plus jitter. Authentication/transport rejection stops reporting and writes a rejected state. Logs contain only state/error classes, never enrollment grants, private keys or raw inventory. Service hosting follows [Microsoft's Windows service reference](https://learn.microsoft.com/en-us/dotnet/core/extensions/windows-service).

## Revocation, removal and recovery

**Revoke device** immediately stops accepting that identity. Inventory/audit records remain. Unused grants can be revoked independently. Lost/revoked identities require a fresh grant and explicitly provisioned new protected identity; old records remain traceable. Failed first enrollment can retry with the stored pending key and same valid grant.

Stop/remove the installed service with `apps/agent/uninstall-service.ps1` in elevated PowerShell and revoke the device in DeskPilot. The script retains binaries and identity data for explicit administrator cleanup. No service, tray startup entry or permanent test enrollment is installed by the browser harness.

## Approved diagnostics

Agent 0.4.0 and later poll the signed command queue every 10–12 seconds in continuous `run` mode. `run --once` remains heartbeat/inventory only. In DeskPilot open **Devices → device → Run diagnostics**. Supply a reason, optionally a visible ticket UUID, and choose gateway ping, Internet, DNS, IP configuration, DHCP information, traceroute or disk check.

The server and agent independently allowlist exact IDs. Network targets are fixed or derived from local adapters. Each check runs in a child process with no shell, a 30-second deadline and 64 KiB output limit. A completed result is encrypted with machine DPAPI in `pending-result.dpapi` using the private identity ACL; network failure retries submission rather than execution. The server may discard results after a lease expires or the identity is revoked. The UI records this as expired/rejected, not success. Cancellation applies only before execution starts.

Disk checks read capacity, accessibility and Windows disk status; they do not perform repairs, a filesystem integrity scan or complete SMART testing. Missing traceroute hops and unanswered ICMP probes can reflect filtering. Internet/DNS checks use `www.microsoft.com`; traceroute uses `1.1.1.1`. An endpoint-specific failure does not prove the entire Internet is unavailable.

`node scripts/diagnostics-browser-check.mjs` exercises all seven checks on the actual Windows host against the disposable browser database and captures the result UI. Run it separately from other browser harnesses because they share that database. The test sends local adapter/disk metadata only to the loopback application. See [the command contract](../architecture/phase-4.md).

## Verification

`node scripts/agent-browser-check.mjs` requires a built agent and the dedicated `deskpilot_browser_test` PostgreSQL database. It recreates only that test schema, enrolls this actual Windows host with a temporary DPAPI directory, verifies signed inventory and a subsequent scheduled heartbeat, tests the UI, revokes the identity, confirms rejection, and cleans up processes and temporary keys. Local inventory is sent only to the loopback test server.

Console-mode collection and the background worker were tested on the real Windows machine. Persistent LocalService installation/reboot behavior, tray interaction, code signing, fleet rollout and production TLS need deployment validation; compilation is not proof of these behaviors.

## Software reports (0.7.0)

`POST /api/v1/agent/software-inventory` uses the existing signed-report protocol. Payload fields are `complete` and `applications`; each entry contains `source_key`, `name`, nullable `version`, `publisher` and `installed_on`. Reports run at startup and every six hours, including `run --once`. Reports cannot select a device ID in the payload; the signature determines the device. Partial scans cannot mark older entries absent. See [scope and limits](../architecture/phase-7.md).
