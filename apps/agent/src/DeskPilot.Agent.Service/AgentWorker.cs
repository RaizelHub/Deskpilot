using System.Net;
using DeskPilot.Agent.Core;
using DeskPilot.Agent.Infrastructure;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace DeskPilot.Agent.Service;

public sealed class AgentWorker(Vault vault, Identity identity, ILogger<AgentWorker> logger, IHostApplicationLifetime lifetime) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var client = new AgentClient(identity); var collector = new Collector(); var failures = 0; var nextInventory = DateTimeOffset.MinValue; var nextSoftware = DateTimeOffset.MinValue; var nextHeartbeat = DateTimeOffset.MinValue; var commands = new CommandProcessor(client, vault); string? lastSuccess = null; string? activeSupportRequestId = null;
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    if (DateTimeOffset.UtcNow >= nextHeartbeat) { await client.Report("heartbeat", await collector.Heartbeat(stoppingToken), stoppingToken); lastSuccess = DateTimeOffset.UtcNow.ToString("O"); nextHeartbeat = DateTimeOffset.UtcNow.AddSeconds(60 + Random.Shared.Next(0, 6)); }
                    if (DateTimeOffset.UtcNow >= nextInventory) { var inventory = collector.Inventory(); await client.Report("inventory", inventory, stoppingToken); nextInventory = DateTimeOffset.UtcNow.AddMinutes(15); }
                    if (DateTimeOffset.UtcNow >= nextSoftware) { await client.Report("software-inventory", SoftwareCollector.Collect(), stoppingToken); nextSoftware = DateTimeOffset.UtcNow.AddHours(6); }
                    await commands.Poll(stoppingToken);
                    var support = await client.Signed("remote-support/poll", new { }, stoppingToken);
                    var requestId = support.GetProperty("data").ValueKind == System.Text.Json.JsonValueKind.Null ? null : support.GetProperty("data").GetProperty("id").GetString();
                    if (requestId != null && requestId != activeSupportRequestId)
                    {
                        logger.LogInformation("Remote support session {RequestId} requested for device.", requestId);
                    }
                    else if (requestId == null && activeSupportRequestId != null)
                    {
                        logger.LogInformation("Remote support session {RequestId} concluded or cancelled.", activeSupportRequestId);
                    }
                    activeSupportRequestId = requestId;
                    failures = 0; vault.Status(new(identity.Server, identity.DeviceId, "connected", lastSuccess, Protocol.Version, "Reporting to DeskPilot.", requestId));
                }
                catch (AgentRejectedException e) when (e.Status is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) { vault.Status(new(identity.Server, identity.DeviceId, "rejected", lastSuccess, Protocol.Version, "Identity rejected. Check revocation, clock synchronization and server transport settings.")); logger.LogWarning("Device authentication rejected. Reporting stopped."); lifetime.StopApplication(); return; }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception e) when (e is HttpRequestException or TaskCanceledException or AgentRejectedException or IOException) { failures++; vault.Status(new(identity.Server, identity.DeviceId, "retrying", lastSuccess, Protocol.Version, "Server report failed. Retrying with backoff.")); logger.LogWarning("Agent report failed ({ErrorType}); retry scheduled.", e.GetType().Name); }
                var seconds = Math.Min(300, 10 * Math.Pow(2, Math.Min(failures, 5))) + Random.Shared.Next(0, 3); await Task.Delay(TimeSpan.FromSeconds(seconds), stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally { if (!File.Exists(vault.StatusPath) || !File.ReadAllText(vault.StatusPath).Contains("rejected")) vault.Status(new(identity.Server, identity.DeviceId, "stopped", lastSuccess, Protocol.Version, "Agent stopped; server will mark the device offline after its heartbeat threshold.")); }
    }
}
