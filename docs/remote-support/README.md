# Phase 6 — Remote support

**Status: approval workflow implemented; live RustDesk integration blocked. Phase 6 acceptance is not complete.**

The technician opens **Remote support**, selects an online device running agent 0.6.0 or newer, selects an open customer-submitted ticket, and enters a reason and requested mode. Only that ticket's authenticated, verified customer can approve. Technicians cannot approve their own requests. Control requests may be approved as view only; view requests cannot be upgraded. Approval expires after two minutes; unanswered requests after five. A device has at most one pending/approved request. Withdrawal, decline and expiry are final; another request requires fresh consent.

The signed Windows service poll returns only the request UUID and expiry. The tray displays a generic notification and **Review support request** opens the authenticated web page showing the technician, ticket, device, reason and choices. This is browser consent following a native notification, not a native three-button consent dialog or proof the customer is physically at the device. Windows can suppress notifications; the support inbox remains available. `agent_received` proves delivery to the authenticated service, not a visible tray prompt. `viewed` means the authenticated page reported being opened.

The worker polls approximately every 10–12 seconds while idle. Diagnostic execution/backoff can delay delivery. Existing 30/minute device rate limits are unchanged. Private signing keys remain inside the protected service vault; the tray reads only public status. `run --once` reports inventory/heartbeat and does not poll requests. Install/start the tray separately for interactive notifications.

Requests and transitions persist in PostgreSQL. Audit metadata binds the customer, technician, ticket, device and modes. Request/consent IPs are stored privately and excluded from customer API responses. There are no actual connection timestamps or durations because no transport connection starts. Reconciliation rejects offline/revoked devices, expired consent, lost technician permissions/ticket visibility, inactive customers and finished/reassigned tickets. The scheduler and agent poll reconcile pending records; mutations also recheck eligibility. Run the scheduler continuously.

## Integration boundary

`GET /api/v1/remote-support/capabilities` always reports `live_connections: false` and `unattended: false`. There is no environment switch to bypass this boundary, no launch endpoint and no customer-provided connected event. No RustDesk software is installed or launched by these changes. Approval alone cannot share a screen. Cancellation withdraws authorization; it does not claim to disconnect a transport.

Official RustDesk documentation describes manual incoming approval and view/control settings. Its documented URI integration is a desktop launch handoff, not evidence of connection. Server Pro documents a running-session Disconnect control in its console, but a supported programmatic contract for DeskPilot mode enforcement, authenticated lifecycle events and termination has not been verified. Internal RustDesk IPC is not used. [Client settings](https://rustdesk.com/docs/en/self-host/client-configuration/advanced-settings/) · [Launch integration](https://rustdesk.com/docs/en/self-host/client-deployment/integrations/tactical-rmm/) · [Pro session controls](https://rustdesk.com/docs/en/self-host/rustdesk-server-pro/audit-logs/)

Before implementing live transport, supply the self-hosted server hostname and OSS/Pro edition, then verify a supported engine integration contract. Do not send private keys or permanent access passwords. Client 1.4.9 and OSS server 1.1.16 were observed in official releases during research; neither is installed or validated here, and release tags are not verified container digests.

Remaining acceptance work:

- Pin actual client/server artifacts and verify integrity and supported control interfaces.
- Bind real engine identity to the requesting technician and customer device; enforce the approved mode, including disabling unapproved clipboard/file transfer/terminal features.
- Require visible local consent on the customer device and maintain an active-sharing indicator.
- Authenticate actual connecting/connected/failed/ended events. Confirm end from the engine before showing a session as ended.
- Verify effective termination by both participants, authorization loss and expiry without unattended fallback.
- Test two physical endpoints: approve/decline, expiry, view-only input rejection, control, mode changes, disconnection, network loss, device/technician revocation and audit duration consistency.

## Self-host preparation

[The optional Compose template](../../infra/rustdesk/compose.yaml) prepares OSS rendezvous/relay services with persistent storage. It is separate from DeskPilot's application stack and does not enable integration. Default ports bind only to localhost for local inspection. Two-device testing needs an intentionally configured reachable host, networking and client public-key trust. The template has not been deployed; the local Docker Linux engine remains unavailable.

1. On the chosen Docker host, select and verify an official `rustdesk/rustdesk-server` image digest. Set `RUSTDESK_SERVER_IMAGE` to that immutable image reference.
2. Validate with `docker compose -f infra/rustdesk/compose.yaml config`. Keep generated private keys in the named volume; only the public key belongs in client configuration.
3. Set `RUSTDESK_BIND_ADDRESS` to the intended host interface when ready for reachable service deployment, then start with `docker compose -f infra/rustdesk/compose.yaml up -d`.
4. Configure both clients with the selected ID/relay host and server public key. Verify native client consent and disconnect before DeskPilot adapter work.

The template exposes TCP 21115/21116/21117 and UDP 21116 only; browser-client ports are omitted. These are based on the [official OSS Docker guide](https://rustdesk.com/docs/en/self-host/rustdesk-server-oss/docker/). Stopping containers preserves the volume; deleting it would destroy server keys and identity.
