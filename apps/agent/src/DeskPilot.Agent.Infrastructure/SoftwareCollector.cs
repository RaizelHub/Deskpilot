using System.Globalization;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;
using DeskPilot.Agent.Core;

namespace DeskPilot.Agent.Infrastructure;

public static class SoftwareCollector
{
    private const string UninstallPath = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    private static string? Text(RegistryKey key, string name, int limit)
    {
        var value = key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
        if (string.IsNullOrWhiteSpace(value)) return null;
        value = value.Trim();
        return value[..Math.Min(value.Length, limit)];
    }

    public static SoftwareReport Collect()
    {
        var applications = new List<SoftwareApplication>();
        var complete = true;
        var bytes = 64;
        var views = Environment.Is64BitOperatingSystem ? new[] { RegistryView.Registry64, RegistryView.Registry32 } : new[] { RegistryView.Registry32 };
        foreach (var view in views)
        {
            try
            {
                using var root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view);
                using var uninstall = root.OpenSubKey(UninstallPath, writable: false);
                if (uninstall is null) continue;
                var names = uninstall.GetSubKeyNames().Order(StringComparer.OrdinalIgnoreCase).ToArray();
                if (names.Length > 2000) complete = false;
                foreach (var name in names.Take(2000))
                {
                    try
                    {
                        using var key = uninstall.OpenSubKey(name, writable: false);
                        if (key is null) { complete = false; continue; }
                        if (key.GetValue("SystemComponent") is int systemComponent && systemComponent == 1) continue;
                        var displayName = Text(key, "DisplayName", 200);
                        if (displayName is null) continue;
                        string? installed = null;
                        if (DateTime.TryParseExact(Text(key, "InstallDate", 8), "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) installed = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                        var source = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{view}:{name.ToUpperInvariant()}")));
                        var application = new SoftwareApplication(source, displayName, Text(key, "DisplayVersion", 100), Text(key, "Publisher", 160), installed);
                        var size = JsonSerializer.SerializeToUtf8Bytes(application, Protocol.Json).Length + 1;
                        if (applications.Count >= 500 || bytes + size > 200000) { complete = false; continue; }
                        bytes += size;
                        applications.Add(application);
                    }
                    catch (Exception e) when (e is IOException or UnauthorizedAccessException or SecurityException) { complete = false; }
                }
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or SecurityException) { complete = false; }
        }
        return new SoftwareReport(complete, applications.OrderBy(a => a.SourceKey, StringComparer.Ordinal).ToArray());
    }
}
