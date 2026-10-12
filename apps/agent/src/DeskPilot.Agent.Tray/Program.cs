using System.Diagnostics;
using System.Text.Json;
using DeskPilot.Agent.Core;
namespace DeskPilot.Agent.Tray;

internal static class Program
{
    [STAThread] private static void Main() { ApplicationConfiguration.Initialize(); Application.Run(new TrayContext()); }
}
internal sealed class TrayContext : ApplicationContext
{
    private readonly NotifyIcon icon = new(); private readonly System.Windows.Forms.Timer timer = new() { Interval = 5000 }; private readonly ToolStripMenuItem state = new("Waiting for agent") { Enabled = false }; private LocalStatus? status; private string? notifiedRequest;
    public TrayContext() { var menu = new ContextMenuStrip(); menu.Items.Add(new ToolStripMenuItem("DeskPilot Agent") { Enabled = false }); menu.Items.Add(state); menu.Items.Add("Review support request", null, (_, _) => OpenSupport(true)); menu.Items.Add("Open support", null, (_, _) => OpenSupport()); menu.Items.Add("Device information", null, (_, _) => MessageBox.Show($"Device: {Environment.MachineName}\nState: {status?.State ?? "Unavailable"}\nLast report: {status?.LastSuccessAt ?? "Never"}\nAgent: {Protocol.Version}\n\n{status?.Message}", "DeskPilot Agent", MessageBoxButtons.OK, MessageBoxIcon.Information)); menu.Items.Add("Exit tray (agent keeps running)", null, (_, _) => ExitThread()); icon.Icon = SystemIcons.Application; icon.Text = "DeskPilot Agent"; icon.ContextMenuStrip = menu; icon.Visible = true; icon.DoubleClick += (_, _) => OpenSupport(); icon.BalloonTipClicked += (_, _) => OpenSupport(true); timer.Tick += (_, _) => Refresh(); timer.Start(); Refresh(); }
    private void Refresh() { try { var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "DeskPilot", "status.json"); status = JsonSerializer.Deserialize<LocalStatus>(File.ReadAllBytes(path), Protocol.Json); var stale = status?.State == "connected" && DateTimeOffset.TryParse(status.LastSuccessAt, out var last) && DateTimeOffset.UtcNow - last > TimeSpan.FromMinutes(3); state.Text = stale ? "No recent report" : status?.State ?? "Unavailable"; } catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException) { state.Text = "Agent status unavailable"; } icon.Text = $"DeskPilot Agent: {state.Text}"; if (status?.State == "connected" && Guid.TryParse(status.SupportRequestId, out _) && status.SupportRequestId != notifiedRequest) { notifiedRequest = status.SupportRequestId; icon.ShowBalloonTip(10000, "DeskPilot support request", "A technician requested support. Sign in to review who is asking and choose whether to approve. Screen sharing has not started.", ToolTipIcon.Info); } }
    private void OpenSupport(bool review = false) { if (status is null) return; try { var origin = Protocol.Server(status.Server, true); Process.Start(new ProcessStartInfo(new Uri(origin, review && Guid.TryParse(status.SupportRequestId, out var requestId) ? $"/support-requests/{requestId}" : "/support-requests").AbsoluteUri) { UseShellExecute = true }); } catch (ArgumentException) { MessageBox.Show("Invalid support server address."); } }
    protected override void ExitThreadCore() { timer.Dispose(); icon.Visible = false; icon.Dispose(); base.ExitThreadCore(); }
}
