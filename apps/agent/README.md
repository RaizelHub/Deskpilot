# DeskPilot Agent · Phase 7

Native C#/.NET 10 Windows worker, Windows-service host, and separate WinForms tray app. Reports hostname, Windows version/build, CPU, physical RAM, fixed disks, motherboard/GPU/model/serial information, network adapters and server-timed heartbeat. It does not collect files, browser content or credentials, and accepts only seven fixed, read-only diagnostic IDs. No shell, PowerShell or arbitrary command arguments are accepted.

See [installation and operation](../../docs/agent/communication.md), [identity protocol](../../docs/architecture/phase-3.md), [diagnostic design](../../docs/architecture/phase-4.md) and [verification](../../docs/verification.md).

Projects: Core (protocol/records), Infrastructure (Windows collection, HTTP, DPAPI/ACL vault), Service (enrollment/worker), Tray (visible status/support links), Checks (protocol and secure-storage assertions).

Build from this directory with the pinned .NET 10 SDK:

```powershell
dotnet build DeskPilot.Agent.slnx -c Release
dotnet run --project tests/DeskPilot.Agent.Checks -c Release -- ../../.local-tools
dotnet publish src/DeskPilot.Agent.Service -c Release -r win-x64 --self-contained true -o publish/service
dotnet publish src/DeskPilot.Agent.Tray -c Release -r win-x64 --self-contained true -o publish/tray
```

Publish outputs include the runtime and must be copied as complete directories. They are ignored build artifacts. Install scripts are explicit administrator actions; building does not install an agent or enable startup. The binaries are not Authenticode-signed.

Agent 0.6.0 adds signed remote-support notification polling and a tray link to the authenticated approval page. It does not launch RustDesk or share the screen. Upgrade the server/migrations before upgrading agents. See [Phase 6 limits and acceptance](../../docs/remote-support/README.md).

Agent 0.7.0 adds machine-wide installed-software inventory at startup and every six hours. `run --once` includes software. Per-user, Store and portable applications are excluded. Bounded or inaccessible collections are marked partial and cannot remove prior observations. Apply Phase 7 server migrations before upgrading the agent. See [asset/software design](../../docs/architecture/phase-7.md).
