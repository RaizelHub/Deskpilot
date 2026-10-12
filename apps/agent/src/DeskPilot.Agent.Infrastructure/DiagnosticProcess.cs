using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.Json;
using DeskPilot.Agent.Core;
namespace DeskPilot.Agent.Infrastructure;

public static class DiagnosticProcess
{
    public static async Task<DiagnosticResult> Run(CommandLease lease, CancellationToken ct)
    {
        if (!Diagnostics.Allowed.Contains(lease.Command) || lease.TimeoutSeconds != 30 || lease.LeaseExpiresAt <= DateTimeOffset.UtcNow) return Diagnostics.Failure("Unapproved command or expired execution contract.", "rejected");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct); deadline.CancelAfter(TimeSpan.FromSeconds(30));
        var executable = Environment.ProcessPath ?? throw new IOException("Cannot locate agent executable."); var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
        if (Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase)) start.ArgumentList.Add(Assembly.GetEntryAssembly()!.Location);
        start.ArgumentList.Add("diagnose"); start.ArgumentList.Add(lease.Command);
        using var process = new Process { StartInfo = start };
        try { process.Start(); var text = new StringBuilder(); var buffer = new char[2048]; int count; while ((count = await process.StandardOutput.ReadAsync(buffer.AsMemory(), deadline.Token)) > 0) { text.Append(buffer, 0, count); if (Encoding.UTF8.GetByteCount(text.ToString()) > 65536) throw new InvalidDataException("Output exceeded limit."); } await process.WaitForExitAsync(deadline.Token); if (process.ExitCode != 0) return Diagnostics.Failure("The diagnostic process exited unsuccessfully."); var result = JsonSerializer.Deserialize<DiagnosticResult>(text.ToString(), Protocol.Json); return Diagnostics.ValidResult(result) ? result! : Diagnostics.Failure("The diagnostic returned an invalid result."); }
        catch (OperationCanceledException) { return Diagnostics.Failure("The diagnostic exceeded its 30-second limit or the agent was stopped."); }
        catch (Exception e) when (e is JsonException or IOException or InvalidOperationException) { return Diagnostics.Failure("Diagnostic output could not be accepted."); }
        finally { try { if (!process.HasExited) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(CancellationToken.None); } } catch (InvalidOperationException) { } }
    }
}
