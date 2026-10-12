using System.Security.Cryptography;
using System.Text.Json;
using DeskPilot.Agent.Core;
using DeskPilot.Agent.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace DeskPilot.Agent.Service;

public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        try
        {
            string? Option(string key) { var i = Array.IndexOf(args, key); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
            var command = args.FirstOrDefault() ?? "run"; var vault = new Vault(Option("--data-dir") ?? Vault.DefaultDirectory);
            if (command == "diagnose") { var result = await Diagnostics.Execute(args.ElementAtOrDefault(1) ?? "", CancellationToken.None); Console.WriteLine(JsonSerializer.Serialize(result, Protocol.Json)); return 0; }
            if (command == "status") { Console.WriteLine(File.Exists(vault.StatusPath) ? File.ReadAllText(vault.StatusPath) : "No agent status is available."); return 0; }
            if (command is not ("enroll" or "run")) { Console.WriteLine("DeskPilot Agent: enroll --server https://host | run [--once] | status. Optional --data-dir PATH. Enrollment token is read from standard input."); return 2; }
            vault.Initialize();
            using var processLock = new FileStream(Path.Combine(vault.DirectoryPath, "agent.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            if (command == "enroll")
            {
                var server = Protocol.Server(Option("--server") ?? throw new ArgumentException("Supply --server."), args.Contains("--allow-loopback-http")).AbsoluteUri;
                Identity identity;
                if (vault.Exists) { identity = vault.Load(); if (identity.DeviceId is not null) throw new InvalidOperationException("Already enrolled. Use a new protected data directory for a new identity."); if (identity.Server != server) throw new InvalidOperationException("Pending enrollment belongs to another server."); }
                else { using var key = RSA.Create(3072); identity = new Identity(server, args.Contains("--allow-loopback-http"), Convert.ToBase64String(key.ExportPkcs8PrivateKey()), null); vault.Save(identity); }
                Console.WriteLine("Enrollment sends this computer's hostname and a public key. Enter your one-use enrollment grant:");
                var token = ReadSecret(); if (token.Length != 64) throw new ArgumentException("Expected a 64-character enrollment grant.");
                using var client = new AgentClient(identity); var id = await client.Enroll(token, CancellationToken.None); vault.Save(identity with { DeviceId = id }); vault.Status(new(server, id, "enrolled", null, Protocol.Version, "Enrolled. Start the agent to report inventory.")); Console.WriteLine("Device enrolled. Private key protected by Windows DPAPI."); return 0;
            }
            var stored = vault.Load(); if (stored.DeviceId is null) throw new InvalidOperationException("Complete enrollment first.");
            if (args.Contains("--once")) { using var client = new AgentClient(stored); var collector = new Collector(); await client.Report("heartbeat", await collector.Heartbeat(CancellationToken.None), CancellationToken.None); await client.Report("inventory", collector.Inventory(), CancellationToken.None); await client.Report("software-inventory", SoftwareCollector.Collect(), CancellationToken.None); vault.Status(new(stored.Server, stored.DeviceId, "connected", DateTimeOffset.UtcNow.ToString("O"), Protocol.Version, "Heartbeat and inventory accepted.")); Console.WriteLine("Real Windows heartbeat, hardware and software inventory accepted."); return 0; }
            var builder = Host.CreateApplicationBuilder(Array.Empty<string>()); builder.Services.AddWindowsService(options => options.ServiceName = "DeskPilotAgent"); builder.Services.AddSingleton(vault); builder.Services.AddSingleton(stored); builder.Services.AddHostedService<AgentWorker>(); await builder.Build().RunAsync(); return 0;
        }
        catch (AgentRejectedException e) { Console.Error.WriteLine(e.Message); return 3; }
        catch (Exception e) { Console.Error.WriteLine($"Agent could not complete the operation ({e.GetType().Name}). Check enrollment, server URL, file permissions and connectivity."); return 1; }
    }
    private static string ReadSecret() { if (Console.IsInputRedirected) return Console.ReadLine()?.Trim() ?? ""; var value = new System.Text.StringBuilder(); while (true) { var k = Console.ReadKey(true); if (k.Key == ConsoleKey.Enter) { Console.WriteLine(); return value.ToString().Trim(); } if (k.Key == ConsoleKey.Backspace) { if (value.Length > 0) value.Length--; } else if (!char.IsControl(k.KeyChar)) value.Append(k.KeyChar); } }
}
