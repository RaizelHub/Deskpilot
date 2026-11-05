using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using DeskPilot.Agent.Core;
using DeskPilot.Agent.Infrastructure;

if (args.Length != 1) throw new ArgumentException("Pass the test scratch root.");
var scratch = Path.GetFullPath(args[0]); var directory = Path.Combine(scratch, "agent-check-" + Guid.NewGuid());
void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
try
{
    using var key = RSA.Create(3072); var body = Encoding.UTF8.GetBytes("{\"cpu_percent\":25}"); var canonical = Protocol.Canonical("/api/v1/agent/heartbeat", "device-id", "1700000000", "nonce", body); var signature = Convert.FromBase64String(Protocol.Sign(key, canonical));
    Check(key.VerifyData(Encoding.UTF8.GetBytes(canonical), signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1), "Signature verification failed");
    Check(!key.VerifyData(Encoding.UTF8.GetBytes(canonical + "tamper"), signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1), "Tampering must fail");
    foreach (var uri in new[] { "http://example.com", "https://user:password@example.com", "https://example.com/path", "file:///C:/data" }) { var rejected = false; try { Protocol.Server(uri, true); } catch (ArgumentException) { rejected = true; } Check(rejected, "Unsafe server accepted"); }
    Check(Protocol.Server("http://127.0.0.1:8002", true).IsLoopback, "Development loopback rejected"); var insecure = false; try { Protocol.Server("http://127.0.0.1:8002", false); } catch (ArgumentException) { insecure = true; }
    Check(insecure, "Loopback HTTP must be explicit");
    var vault = new Vault(directory); vault.Initialize(); var identity = new Identity("https://example.com/", false, Convert.ToBase64String(key.ExportPkcs8PrivateKey()), Guid.NewGuid().ToString()); vault.Save(identity); Check(vault.Load() == identity, "DPAPI identity roundtrip failed");
    var filename = Path.Combine(directory, "identity.dpapi"); Check(!Encoding.UTF8.GetString(File.ReadAllBytes(filename)).Contains(identity.PrivateKey), "Private key stored in plaintext");
    var acl = new FileInfo(filename).GetAccessControl(); Check(acl.AreAccessRulesProtected, "Private key inherits unsafe directory permissions"); var users = new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null); Check(!acl.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().Any(r => r.IdentityReference.Equals(users) && r.AccessControlType == AccessControlType.Allow), "General users can read private identity");
    var rejectedCommand = await Diagnostics.Execute("powershell.exe", CancellationToken.None);
    Check(rejectedCommand.Status == "rejected", "Unknown command must never execute");
    Check(!Diagnostics.ValidResult(new DiagnosticResult("succeeded", "Invalid output", 1, [new("Result", "pass", new string('x', 2001))])), "Oversized result accepted");
    Check(!Diagnostics.ValidResult(new DiagnosticResult("succeeded", null!, 1, [])), "Null summary accepted");
    Check(Diagnostics.Allowed.Contains("network.comprehensive_troubleshoot"), "Network troubleshooting command must be approved in Allowed list");
    var networkCheck = await Diagnostics.Execute("network.comprehensive_troubleshoot", CancellationToken.None);
    Check(Diagnostics.ValidResult(networkCheck), "Network troubleshooting returned invalid diagnostic schema");
    Check(networkCheck.Checks.Any(c => c.Name == "Troubleshooting Classification"), "Classification check missing from network troubleshooting");
    var pending = new PendingResult(Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), rejectedCommand);
    vault.SavePending(pending); var restored = vault.LoadPending();
    Check(restored?.CommandId == pending.CommandId && restored.Result.Summary == rejectedCommand.Summary, "Pending result DPAPI roundtrip failed");
    Check(!Encoding.UTF8.GetString(File.ReadAllBytes(Path.Combine(directory, "pending-result.dpapi"))).Contains(pending.CommandId), "Pending result stored in plaintext");
    vault.ClearPending(); Check(vault.LoadPending() is null, "Acknowledged result not cleared");
    var software = SoftwareCollector.Collect();
    Check(software.Applications.Length <= 500, "Software report count exceeds limit");
    Check(System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(software, Protocol.Json).Length < 262144, "Software report exceeds transport limit");
    Check(software.Applications.Select(a => a.SourceKey).Distinct().Count() == software.Applications.Length, "Software source keys must be unique");
    Check(software.Applications.All(a => a.SourceKey.Length == 64 && !string.IsNullOrWhiteSpace(a.Name) && a.Name.Length <= 200), "Invalid software identity or display name");
    Console.WriteLine("Agent checks passed: signatures, tamper rejection, secure origins, DPAPI identity/result persistence, private-file ACL, diagnostic boundaries and real Windows software report bounds/identity.");
}
finally { if (Path.GetDirectoryName(directory) != scratch) throw new InvalidOperationException("Unsafe cleanup path"); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
