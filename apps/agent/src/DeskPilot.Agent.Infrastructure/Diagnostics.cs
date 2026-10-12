using System.Diagnostics;
using System.Management;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;
using DeskPilot.Agent.Core;

namespace DeskPilot.Agent.Infrastructure;

public static class Diagnostics
{
    public static readonly IReadOnlySet<string> Allowed = new HashSet<string>(StringComparer.Ordinal) { "network.ping_gateway", "network.test_internet", "network.test_dns", "network.ip_configuration", "network.dhcp_information", "network.traceroute", "system.check_disk" };
    public static DiagnosticResult Failure(string summary, string status = "failed") => new(status, summary, 0, [new("Execution", "fail", summary)]);
    public static bool ValidResult(DiagnosticResult? r) => r is not null && new[] { "succeeded", "failed", "rejected" }.Contains(r.Status) && r.Summary is { Length: > 0 and <= 1000 } && r.DurationMs is >= 0 and <= 60000 && r.Checks is { Length: <= 64 } && r.Checks.All(c => c is not null && c.Name is { Length: > 0 and <= 120 } && c.Detail is { Length: > 0 and <= 2000 } && new[] { "pass", "fail", "warning", "info" }.Contains(c.Status) && (c.DurationMs is null or >= 0 and <= 60000));
    public static async Task<DiagnosticResult> Execute(string command, CancellationToken ct)
    {
        if (!Allowed.Contains(command)) return Failure("This command is not approved by the Windows agent.", "rejected");
        var timer = Stopwatch.StartNew();
        try
        {
            var checks = command switch
            {
                "network.ping_gateway" => await PingGateways(ct),
                "network.test_internet" => await Internet(ct),
                "network.test_dns" => await DnsTest(ct),
                "network.ip_configuration" => IpConfiguration(),
                "network.dhcp_information" => Dhcp(),
                "network.traceroute" => await Trace(ct),
                "system.check_disk" => Disks(),
                _ => throw new InvalidOperationException()
            };
            if (checks.Length == 0) checks = [new("Availability", "warning", "Windows returned no matching data.")];
            var failed = checks.Any(c => c.Status == "fail"); var warning = checks.Any(c => c.Status == "warning");
            return new(failed ? "failed" : "succeeded", failed ? "The diagnostic found a failed check. Review the measured result below." : warning ? "Completed with limitations or warnings. Review the result below." : "The approved read-only check completed.", (int)timer.ElapsedMilliseconds, checks.Take(64).ToArray());
        }
        catch (OperationCanceledException) { return Failure("The diagnostic reached its time limit or was cancelled."); }
        catch (Exception e) when (e is HttpRequestException or SocketException or PingException or ManagementException or UnauthorizedAccessException or IOException or NetworkInformationException) { return Failure($"Windows could not complete this check ({e.GetType().Name})."); }
    }
    private static async Task<DiagnosticCheck[]> Internet(CancellationToken ct)
    {
        using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(8) };
        var timer = Stopwatch.StartNew(); using var request = new HttpRequestMessage(HttpMethod.Head, "https://www.microsoft.com/"); using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        return [new("HTTPS connectivity", (int)response.StatusCode is >= 200 and < 400 ? "pass" : "fail", $"https://www.microsoft.com returned HTTP {(int)response.StatusCode}. This tests only this endpoint; proxy or firewall policy can affect the result.", (int)timer.ElapsedMilliseconds)];
    }
    private static async Task<DiagnosticCheck[]> DnsTest(CancellationToken ct) { var timer = Stopwatch.StartNew(); var addresses = await Dns.GetHostAddressesAsync("www.microsoft.com", ct); return [new("DNS resolution", addresses.Length > 0 ? "pass" : "fail", "www.microsoft.com → " + string.Join(", ", addresses.Take(16).Select(a => a.ToString())), (int)timer.ElapsedMilliseconds)]; }
    private static async Task<DiagnosticCheck[]> PingGateways(CancellationToken ct)
    {
        var gateways = NetworkInterface.GetAllNetworkInterfaces().Where(n => n.OperationalStatus == OperationalStatus.Up).SelectMany(n => n.GetIPProperties().GatewayAddresses).Select(g => g.Address).Where(a => !a.Equals(IPAddress.Any) && !a.Equals(IPAddress.IPv6Any)).Distinct().Take(4).ToArray(); var checks = new List<DiagnosticCheck>();
        foreach (var gateway in gateways)
        {
            var received = 0; var times = new List<long>(); for (var i = 0; i < 2; i++) { using var ping = new Ping(); var reply = await ping.SendPingAsync(gateway, TimeSpan.FromMilliseconds(1200), new byte[16], new PingOptions(64, true), ct); if (reply.Status == IPStatus.Success) { received++; times.Add(reply.RoundtripTime); } }
            checks.Add(new("Gateway " + gateway, received > 0 ? (received == 2 ? "pass" : "warning") : "fail", $"Received {received}/2 replies; packet loss {(2 - received) * 50}%. " + (received > 0 ? $"Average round-trip {times.Average():0.0} ms." : "No ICMP response. Filtering can block ping even when routing works.")));
        }
        return checks.ToArray();
    }
    private static DiagnosticCheck[] IpConfiguration() => NetworkInterface.GetAllNetworkInterfaces().Where(n => n.NetworkInterfaceType != NetworkInterfaceType.Loopback && n.OperationalStatus == OperationalStatus.Up).Take(32).Select(n => { var p = n.GetIPProperties(); return new DiagnosticCheck(n.Name[..Math.Min(n.Name.Length, 120)], "info", Trim($"Link: {n.OperationalStatus}; IP: {string.Join(", ", p.UnicastAddresses.Take(12).Select(a => a.Address))}; Gateway: {string.Join(", ", p.GatewayAddresses.Take(8).Select(a => a.Address))}; DNS: {string.Join(", ", p.DnsAddresses.Take(8))}")); }).ToArray();
    private static DiagnosticCheck[] Dhcp()
    {
        var rows = new List<DiagnosticCheck>(); using var searcher = new ManagementObjectSearcher(new ManagementScope(@"\\.\root\cimv2"), new ObjectQuery("SELECT Description,DHCPEnabled,DHCPServer,DHCPLeaseObtained,DHCPLeaseExpires FROM Win32_NetworkAdapterConfiguration WHERE IPEnabled = TRUE"), new System.Management.EnumerationOptions { Timeout = TimeSpan.FromSeconds(8), ReturnImmediately = false }); using var results = searcher.Get();
        foreach (ManagementObject row in results) { using (row) { var name = Convert.ToString(row["Description"]) ?? "Adapter"; var enabled = Convert.ToBoolean(row["DHCPEnabled"]); rows.Add(new(name[..Math.Min(name.Length, 120)], "info", Trim($"DHCP: {(enabled ? "enabled" : "disabled / static")}; Server: {row["DHCPServer"] ?? "not reported"}; Lease obtained: {Lease(row["DHCPLeaseObtained"])}; Lease expires: {Lease(row["DHCPLeaseExpires"])}"))); if (rows.Count >= 32) break; } }
        return rows.ToArray();
    }
    private static string Lease(object? value) { if (value is not string s) return "not reported"; try { return ManagementDateTimeConverter.ToDateTime(s).ToUniversalTime().ToString("O"); } catch (ArgumentException) { return "not reported"; } }
    private static async Task<DiagnosticCheck[]> Trace(CancellationToken ct)
    {
        var rows = new List<DiagnosticCheck>(); var target = IPAddress.Parse("1.1.1.1"); var reached = false;
        for (var ttl = 1; ttl <= 12; ttl++) { using var ping = new Ping(); var reply = await ping.SendPingAsync(target, TimeSpan.FromMilliseconds(800), new byte[16], new PingOptions(ttl, true), ct); rows.Add(new($"Hop {ttl}", reply.Status == IPStatus.Success ? "pass" : "info", $"{reply.Address?.ToString() ?? "No responding hop"} · {reply.Status} · {reply.RoundtripTime} ms")); if (reply.Status == IPStatus.Success) { reached = true; break; } }
        rows.Add(new("Route to 1.1.1.1", reached ? "pass" : "warning", reached ? "Destination replied." : "Destination did not reply within 12 hops. This is a partial route; missing ICMP responses do not prove an Internet outage.")); return rows.ToArray();
    }
    private static DiagnosticCheck[] Disks()
    {
        var rows = new List<DiagnosticCheck>(); foreach (var disk in DriveInfo.GetDrives().Where(d => d.DriveType == DriveType.Fixed).Take(32)) { try { if (!disk.IsReady) { rows.Add(new(disk.Name, "warning", "The fixed disk is not ready.")); continue; } var percent = disk.TotalSize == 0 ? 0 : 100.0 * disk.TotalFreeSpace / disk.TotalSize; rows.Add(new(disk.Name, percent < 10 ? "warning" : "pass", $"{disk.TotalFreeSpace} bytes free / {disk.TotalSize} bytes total ({percent:0.0}% free); filesystem {disk.DriveFormat}. No repair or filesystem integrity scan performed.")); } catch (IOException) { rows.Add(new(disk.Name, "fail", "Windows could not read disk capacity.")); } }
        using var searcher = new ManagementObjectSearcher("SELECT Model,Status FROM Win32_DiskDrive"); using var results = searcher.Get(); foreach (ManagementObject disk in results) { using (disk) { var status = Convert.ToString(disk["Status"]) ?? "Not reported"; rows.Add(new("Windows disk status", status == "OK" ? "info" : "warning", Trim($"{disk["Model"]}: {status}. This provider status is not a complete SMART or surface test."))); if (rows.Count >= 64) break; } }
        return rows.ToArray();
    }
    private static string Trim(string value) => value[..Math.Min(2000, value.Length)];
}
