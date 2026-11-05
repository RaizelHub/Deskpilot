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
    public static readonly IReadOnlySet<string> Allowed = new HashSet<string>(StringComparer.Ordinal) { "network.ping_gateway", "network.test_internet", "network.test_dns", "network.ip_configuration", "network.dhcp_information", "network.traceroute", "network.comprehensive_troubleshoot", "system.check_disk" };
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
                "network.comprehensive_troubleshoot" => await ComprehensiveNetworkTroubleshoot(ct),
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
    private static async Task<DiagnosticCheck[]> ComprehensiveNetworkTroubleshoot(CancellationToken ct)
    {
        var checks = new List<DiagnosticCheck>();
        var activeInterfaces = NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.NetworkInterfaceType != NetworkInterfaceType.Loopback && n.OperationalStatus == OperationalStatus.Up)
            .ToArray();

        // 1. Adapter Check
        if (activeInterfaces.Length == 0)
        {
            checks.Add(new("Network Adapter", "fail", "No active non-loopback network adapter found. Physical or wireless network interface is disconnected."));
            checks.Add(new("Troubleshooting Classification", "fail", "NO_ACTIVE_ADAPTER: Connect an Ethernet cable or join a Wi-Fi network."));
            return checks.ToArray();
        }

        var primary = activeInterfaces.First();
        var props = primary.GetIPProperties();
        checks.Add(new("Network Adapter", "pass", Trim($"Primary adapter '{primary.Name}' is {primary.OperationalStatus} ({primary.NetworkInterfaceType}, {primary.Speed / 1_000_000} Mbps). Total active adapters: {activeInterfaces.Length}.")));

        // 2. IPv4 Configuration & DHCP
        var ipv4Unicasts = props.UnicastAddresses.Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork).ToArray();
        if (ipv4Unicasts.Length == 0)
        {
            checks.Add(new("IPv4 Configuration", "fail", "No IPv4 address assigned to the active adapter."));
            checks.Add(new("Troubleshooting Classification", "fail", "NO_IPV4_CONFIG: Device has no valid IPv4 address. Check DHCP service or static configuration."));
            return checks.ToArray();
        }

        var apipa = ipv4Unicasts.All(a => a.Address.ToString().StartsWith("169.254."));
        var assignedIps = string.Join(", ", ipv4Unicasts.Select(a => $"{a.Address}/{a.IPv4Mask}"));
        if (apipa)
        {
            checks.Add(new("IPv4 Configuration", "fail", $"APIPA address assigned ({assignedIps}). DHCP server did not respond or offer a lease."));
            checks.Add(new("Troubleshooting Classification", "fail", "DHCP_CONFIG_FAILURE: Windows self-assigned an APIPA 169.254.x.x address because DHCP lease failed."));
            return checks.ToArray();
        }
        checks.Add(new("IPv4 Configuration", "pass", Trim($"Valid IPv4 configuration: {assignedIps}.")));

        // 3. Gateway Reachability
        var gateways = props.GatewayAddresses.Select(g => g.Address).Where(a => !a.Equals(IPAddress.Any) && !a.Equals(IPAddress.IPv6Any)).Distinct().ToArray();
        var gatewayReachable = false;
        var gatewayChecked = false;
        if (gateways.Length == 0)
        {
            checks.Add(new("Default Gateway", "warning", "No default gateway configured on active adapter. Local network only."));
        }
        else
        {
            gatewayChecked = true;
            var primaryGw = gateways[0];
            var received = 0;
            var times = new List<long>();
            for (var i = 0; i < 2; i++)
            {
                using var ping = new Ping();
                try
                {
                    var reply = await ping.SendPingAsync(primaryGw, TimeSpan.FromMilliseconds(1200), new byte[16], new PingOptions(64, true), ct);
                    if (reply.Status == IPStatus.Success) { received++; times.Add(reply.RoundtripTime); }
                }
                catch (PingException) { }
            }
            if (received > 0)
            {
                gatewayReachable = true;
                checks.Add(new("Default Gateway", "pass", $"Gateway {primaryGw} reachable ({received}/2 replies, avg {times.Average():0.0} ms)."));
            }
            else
            {
                checks.Add(new("Default Gateway", "warning", $"Gateway {primaryGw} did not respond to ICMP ping (100% loss). May be blocked by router firewall."));
            }
        }

        // 4. DNS Resolution
        var dnsServers = props.DnsAddresses.Take(4).Select(a => a.ToString()).ToArray();
        var dnsSucceeded = false;
        try
        {
            var addresses = await Dns.GetHostAddressesAsync("www.microsoft.com", ct);
            if (addresses.Length > 0)
            {
                dnsSucceeded = true;
                checks.Add(new("DNS Resolution", "pass", Trim($"www.microsoft.com resolved successfully ({addresses.Length} addresses). Configured DNS: {string.Join(", ", dnsServers)}.")));
            }
            else
            {
                checks.Add(new("DNS Resolution", "fail", "DNS returned zero addresses for www.microsoft.com."));
            }
        }
        catch (Exception e) when (e is SocketException or ArgumentException)
        {
            checks.Add(new("DNS Resolution", "fail", $"DNS resolution of www.microsoft.com failed: {e.Message}. Configured DNS: {string.Join(", ", dnsServers)}."));
        }

        // 5. Internet Connectivity (HTTPS)
        var internetSucceeded = false;
        try
        {
            using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(5) };
            using var req = new HttpRequestMessage(HttpMethod.Head, "https://www.microsoft.com/");
            using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
            if ((int)resp.StatusCode >= 200 && (int)resp.StatusCode < 400)
            {
                internetSucceeded = true;
                checks.Add(new("Internet Connectivity", "pass", $"Outbound HTTPS succeeded (HTTP {(int)resp.StatusCode} from https://www.microsoft.com/)."));
            }
            else
            {
                checks.Add(new("Internet Connectivity", "warning", $"Outbound HTTPS returned HTTP {(int)resp.StatusCode}. Endpoint reached but non-standard response."));
            }
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or SocketException)
        {
            checks.Add(new("Internet Connectivity", "fail", $"Outbound HTTPS connection failed ({e.GetType().Name}). Outbound 443 traffic blocked or network disconnected."));
        }

        // 6. DeskPilot Backend Reachability
        string? serverUrl = null;
        try
        {
            var statusPath = Path.Combine(Vault.DefaultDirectory, "status.json");
            if (File.Exists(statusPath))
            {
                var doc = JsonSerializer.Deserialize<LocalStatus>(File.ReadAllBytes(statusPath), Protocol.Json);
                serverUrl = doc?.Server;
            }
        }
        catch { }

        if (!string.IsNullOrEmpty(serverUrl))
        {
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
                var testUri = new Uri(new Uri(serverUrl), "api/v1/remote-support/capabilities");
                using var resp = await http.GetAsync(testUri, ct);
                if (resp.IsSuccessStatusCode)
                {
                    checks.Add(new("DeskPilot Backend", "pass", $"DeskPilot server at {serverUrl} is reachable and responding (HTTP {(int)resp.StatusCode})."));
                }
                else
                {
                    checks.Add(new("DeskPilot Backend", "fail", $"DeskPilot server at {serverUrl} responded with HTTP {(int)resp.StatusCode}."));
                }
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or SocketException)
            {
                checks.Add(new("DeskPilot Backend", "fail", $"Cannot connect to DeskPilot backend at {serverUrl} ({e.GetType().Name})."));
            }
        }
        else
        {
            checks.Add(new("DeskPilot Backend", "info", "No enrolled DeskPilot server URL stored locally; backend check skipped."));
        }

        // 7. Overall Classification
        string classificationCode;
        string classificationDetail;
        string classificationStatus;

        if (!dnsSucceeded && !internetSucceeded && gatewayChecked && !gatewayReachable)
        {
            classificationCode = "GATEWAY_UNREACHABLE";
            classificationStatus = "fail";
            classificationDetail = "Local gateway connectivity failure: gateway does not respond and external traffic is unreachable. Verify physical router, switch port, or VLAN configuration.";
        }
        else if (!dnsSucceeded && internetSucceeded)
        {
            classificationCode = "DNS_RESOLUTION_FAILURE";
            classificationStatus = "fail";
            classificationDetail = "DNS resolution failure: Internet is reachable directly but configured DNS servers failed to resolve domain names. Check DNS server IP settings.";
        }
        else if (!internetSucceeded && dnsSucceeded)
        {
            classificationCode = "INTERNET_CONNECTIVITY_FAILURE";
            classificationStatus = "fail";
            classificationDetail = "Internet connectivity failure: DNS resolves, but outbound HTTP/HTTPS connections are blocked. Inspect firewall, proxy, or captive portal.";
        }
        else if (checks.Any(c => c.Name == "DeskPilot Backend" && c.Status == "fail") && internetSucceeded)
        {
            classificationCode = "BACKEND_UNAVAILABLE";
            classificationStatus = "fail";
            classificationDetail = "DeskPilot backend unavailable: Internet connection is healthy, but the DeskPilot server endpoint is not responding.";
        }
        else if (checks.Any(c => c.Status == "fail"))
        {
            classificationCode = "UNKNOWN_FAILURE";
            classificationStatus = "fail";
            classificationDetail = "Network failure detected. Review individual check details above.";
        }
        else if (checks.Any(c => c.Status == "warning"))
        {
            classificationCode = "HEALTHY_WITH_LIMITATIONS";
            classificationStatus = "warning";
            classificationDetail = "Network is functioning with minor limitations (e.g. gateway ICMP filtered or no gateway configured).";
        }
        else
        {
            classificationCode = "HEALTHY";
            classificationStatus = "pass";
            classificationDetail = "All network layers operating normally: adapter up, valid IPv4, gateway reachable, DNS resolving, outbound HTTPS, and backend online.";
        }

        checks.Add(new("Troubleshooting Classification", classificationStatus, $"{classificationCode}: {classificationDetail}"));
        return checks.ToArray();
    }
    private static string Trim(string value) => value[..Math.Min(2000, value.Length)];
}
