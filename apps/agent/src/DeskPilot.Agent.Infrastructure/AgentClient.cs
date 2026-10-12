using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using DeskPilot.Agent.Core;

namespace DeskPilot.Agent.Infrastructure;

public sealed class AgentRejectedException(HttpStatusCode status) : Exception($"Server rejected agent request ({(int)status}).") { public HttpStatusCode Status { get; } = status; }
public sealed class AgentClient : IDisposable
{
    private readonly HttpClient http; private readonly Identity identity; private readonly RSA key;
    public AgentClient(Identity identity) { this.identity = identity; key = RSA.Create(); key.ImportPkcs8PrivateKey(Convert.FromBase64String(identity.PrivateKey), out _); http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { BaseAddress = Protocol.Server(identity.Server, identity.AllowLoopbackHttp), Timeout = TimeSpan.FromSeconds(30) }; }
    public string PublicKey => key.ExportSubjectPublicKeyInfoPem();
    public async Task<string> Enroll(string token, CancellationToken ct) { var response = await Send("enroll", new { token, public_key = PublicKey, hostname = Environment.MachineName, agent_version = Protocol.Version }, false, ct); return response.GetProperty("device_id").GetString() ?? throw new IOException("No device identity returned."); }
    public async Task Report(string route, object report, CancellationToken ct) => _ = await Send(route, report, true, ct);
    public Task<JsonElement> Signed(string route, object payload, CancellationToken ct) => Send(route, payload, true, ct);
    private async Task<JsonElement> Send(string route, object payload, bool signed, CancellationToken ct)
    {
        var path = "/api/v1/agent/" + route; var body = JsonSerializer.SerializeToUtf8Bytes(payload, Protocol.Json);
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new ByteArrayContent(body) }; request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json"); request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (signed) { var id = identity.DeviceId ?? throw new IOException("Enroll first."); var time = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture); var nonce = Guid.NewGuid().ToString(); request.Headers.Add("X-Device-Id", id); request.Headers.Add("X-Agent-Time", time); request.Headers.Add("X-Agent-Nonce", nonce); request.Headers.Add("X-Agent-Signature", Protocol.Sign(key, Protocol.Canonical(path, id, time, nonce, body))); }
        using var response = await http.SendAsync(request, ct); if (!response.IsSuccessStatusCode) throw new AgentRejectedException(response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct)); return doc.RootElement.Clone();
    }
    public void Dispose() { http.Dispose(); key.Dispose(); }
}
