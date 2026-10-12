using System.Net;
using System.Text.Json;
using DeskPilot.Agent.Core;
namespace DeskPilot.Agent.Infrastructure;

public sealed class CommandProcessor(AgentClient client, Vault vault)
{
    public async Task Poll(CancellationToken ct)
    {
        var pending = vault.LoadPending(); if (pending is not null) { await Submit(pending, ct); return; }
        var response = await client.Signed("commands/claim", new { }, ct); var data = response.GetProperty("data"); if (data.ValueKind == JsonValueKind.Null) return;
        var lease = data.Deserialize<CommandLease>(Protocol.Json) ?? throw new IOException("Invalid command lease."); if (!Guid.TryParseExact(lease.Id, "D", out _) || !Guid.TryParseExact(lease.LeaseId, "D", out _)) throw new IOException("Invalid command identifiers.");
        try
        {
            var start = await client.Signed($"commands/{lease.Id}/start", new { lease_id = lease.LeaseId }, ct); if (start.GetProperty("status").GetString() != "running") return;
            var result = await DiagnosticProcess.Run(lease, ct); pending = new PendingResult(lease.Id, lease.LeaseId, result); vault.SavePending(pending); await Submit(pending, ct);
        }
        catch (AgentRejectedException e) when (e.Status is HttpStatusCode.Conflict or HttpStatusCode.NotFound) {/* Cancellation/expiry won the race. No new execution is authorized. */}
    }
    private async Task Submit(PendingResult pending, CancellationToken ct)
    {
        try { await client.Signed($"commands/{pending.CommandId}/result", new { lease_id = pending.LeaseId, status = pending.Result.Status, summary = pending.Result.Summary, duration_ms = pending.Result.DurationMs, checks = pending.Result.Checks }, ct); vault.ClearPending(); }
        catch (AgentRejectedException e) when (e.Status is HttpStatusCode.Conflict or HttpStatusCode.NotFound) { vault.ClearPending(); }
    }
}
