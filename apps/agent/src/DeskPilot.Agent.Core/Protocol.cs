using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace DeskPilot.Agent.Core;

public static class Protocol
{
    public const string Version = "0.7.0";
    public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower, PropertyNameCaseInsensitive = true };
    public static string Canonical(string path, string id, string timestamp, string nonce, byte[] body) => string.Join('\n', "v1", "POST", path, id, timestamp, nonce, Convert.ToHexStringLower(SHA256.HashData(body)));
    public static string Sign(RSA key, string canonical) => Convert.ToBase64String(key.SignData(Encoding.UTF8.GetBytes(canonical), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
    public static Uri Server(string value, bool allowLoopback)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || !string.IsNullOrEmpty(uri.UserInfo) || uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)) throw new ArgumentException("Use the server origin, for example https://deskpilot.example.com.");
        if (uri.Scheme != "https" && !(allowLoopback && uri.Scheme == "http" && uri.IsLoopback)) throw new ArgumentException("HTTPS is required. Loopback HTTP requires the explicit development flag.");
        return uri;
    }
}
public sealed record Hardware(string? OsName, string? OsVersion, string? OsBuild, string? CpuName, int? CpuCores, long? RamTotalBytes, string? Manufacturer, string? Model, string? SerialNumber, string? Motherboard, string? Gpu, string? BootTime);
public sealed record Disk(string Name, string? FileSystem, long TotalBytes, long FreeBytes);
public sealed record Network(string InterfaceId, string Name, string? MacAddress, bool IsUp, string[] Addresses, string[] Gateways, string[] DnsServers);
public sealed record Inventory(string Hostname, Hardware Hardware, Disk[] Disks, Network[] Interfaces);
public sealed record Heartbeat(string AgentVersion, double? CpuPercent, long? RamAvailableBytes, long UptimeSeconds, bool? NetworkConnected);
public sealed record Identity(string Server, bool AllowLoopbackHttp, string PrivateKey, string? DeviceId);
public sealed record LocalStatus(string Server, string? DeviceId, string State, string? LastSuccessAt, string AgentVersion, string Message, string? SupportRequestId = null);
public sealed record DiagnosticCheck(string Name, string Status, string Detail, int? DurationMs = null);
public sealed record DiagnosticResult(string Status, string Summary, int DurationMs, DiagnosticCheck[] Checks);
public sealed record CommandLease(string Id, string Command, string LeaseId, DateTimeOffset LeaseExpiresAt, int TimeoutSeconds);
public sealed record PendingResult(string CommandId, string LeaseId, DiagnosticResult Result);

public sealed record SoftwareApplication(string SourceKey, string Name, string? Version, string? Publisher, string? InstalledOn);
public sealed record SoftwareReport(bool Complete, SoftwareApplication[] Applications);
