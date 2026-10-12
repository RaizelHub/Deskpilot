using System.Management;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using DeskPilot.Agent.Core;

namespace DeskPilot.Agent.Infrastructure;

public sealed class Collector
{
    private static Dictionary<string, object?> Query(string query)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(new ManagementScope(@"\\.\root\cimv2"), new ObjectQuery(query), new System.Management.EnumerationOptions { Timeout = TimeSpan.FromSeconds(5), ReturnImmediately = false });
            using var results = searcher.Get();
            foreach (ManagementObject item in results) { using (item) return item.Properties.Cast<PropertyData>().ToDictionary(p => p.Name, p => (object?)p.Value, StringComparer.OrdinalIgnoreCase); }
        }
        catch (Exception e) when (e is ManagementException or UnauthorizedAccessException or COMException) { }
        return new();
    }
    private static string? Text(Dictionary<string, object?> data, string key) => data.TryGetValue(key, out var v) && v is not null ? Convert.ToString(v)?[..Math.Min(Convert.ToString(v)!.Length, 200)] : null;
    private static long? Number(Dictionary<string, object?> data, string key) => data.TryGetValue(key, out var v) && v is not null ? Convert.ToInt64(v) : null;
    public Inventory Inventory()
    {
        var os = Query("SELECT Caption,Version,BuildNumber,LastBootUpTime FROM Win32_OperatingSystem");
        var cpu = Query("SELECT Name,NumberOfCores FROM Win32_Processor");
        var system = Query("SELECT Manufacturer,Model,TotalPhysicalMemory FROM Win32_ComputerSystem");
        var bios = Query("SELECT SerialNumber FROM Win32_BIOS");
        var board = Query("SELECT Product FROM Win32_BaseBoard");
        var gpu = Query("SELECT Name FROM Win32_VideoController");
        string? boot = null; var raw = Text(os, "LastBootUpTime"); if (raw is not null) { try { boot = ManagementDateTimeConverter.ToDateTime(raw).ToUniversalTime().ToString("O"); } catch (ArgumentException) { } }
        var hardware = new Hardware(Text(os, "Caption"), Text(os, "Version"), Text(os, "BuildNumber"), Text(cpu, "Name"), (int?)Number(cpu, "NumberOfCores"), Number(system, "TotalPhysicalMemory"), Text(system, "Manufacturer"), Text(system, "Model"), Text(bios, "SerialNumber"), Text(board, "Product"), Text(gpu, "Name"), boot);
        var disks = new List<Disk>();
        foreach (var drive in DriveInfo.GetDrives().Where(d => d.DriveType == DriveType.Fixed).Take(64)) { try { if (drive.IsReady) disks.Add(new Disk(drive.Name, drive.DriveFormat, drive.TotalSize, drive.TotalFreeSpace)); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { } }
        var networks = new List<Network>();
        foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces().Where(n => n.NetworkInterfaceType != NetworkInterfaceType.Loopback).Take(64))
        {
            try
            {
                var props = adapter.GetIPProperties(); string Address(System.Net.IPAddress ip) => ip.ToString().Split('%')[0];
                networks.Add(new Network(adapter.Id, adapter.Name[..Math.Min(adapter.Name.Length, 200)], adapter.GetPhysicalAddress().ToString(), adapter.OperationalStatus == OperationalStatus.Up, props.UnicastAddresses.Select(a => Address(a.Address)).Take(32).ToArray(), props.GatewayAddresses.Select(a => Address(a.Address)).Take(32).ToArray(), props.DnsAddresses.Select(Address).Take(32).ToArray()));
            }
            catch (NetworkInformationException) { }
        }
        return new Inventory(Environment.MachineName, hardware, disks.OrderBy(d => d.Name).ToArray(), networks.OrderBy(n => n.InterfaceId).ToArray());
    }
    [StructLayout(LayoutKind.Sequential)] private struct FileTime { public uint Low; public uint High; public ulong Value => ((ulong)High << 32) | Low; }
    [DllImport("kernel32.dll", SetLastError = true)][return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetSystemTimes(out FileTime idle, out FileTime kernel, out FileTime user);
    public async Task<Heartbeat> Heartbeat(CancellationToken ct)
    {
        double? cpu = null;
        if (GetSystemTimes(out var i1, out var k1, out var u1)) { await Task.Delay(500, ct); if (GetSystemTimes(out var i2, out var k2, out var u2)) { var total = (k2.Value - k1.Value) + (u2.Value - u1.Value); if (total > 0) cpu = Math.Clamp(100.0 * (total - (i2.Value - i1.Value)) / total, 0, 100); } }
        var os = Query("SELECT FreePhysicalMemory FROM Win32_OperatingSystem"); bool? connected = null; try { connected = NetworkInterface.GetIsNetworkAvailable(); } catch (NetworkInformationException) { }
        return new Heartbeat(Protocol.Version, cpu is null ? null : Math.Round(cpu.Value, 2), Number(os, "FreePhysicalMemory") * 1024, Environment.TickCount64 / 1000, connected);
    }
}
