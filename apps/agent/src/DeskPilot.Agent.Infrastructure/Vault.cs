using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;
using DeskPilot.Agent.Core;

namespace DeskPilot.Agent.Infrastructure;

public sealed class Vault
{
    public static string DefaultDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "DeskPilot");
    public string DirectoryPath { get; }
    public string StatusPath => Path.Combine(DirectoryPath, "status.json");
    private string IdentityPath => Path.Combine(DirectoryPath, "identity.dpapi");
    public Vault(string directory) { DirectoryPath = Path.GetFullPath(directory); }
    private static IEnumerable<SecurityIdentifier> Writers() => new[] { new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), new SecurityIdentifier(WellKnownSidType.LocalServiceSid, null), WindowsIdentity.GetCurrent().User! }.DistinctBy(s => s.Value);
    public void Initialize()
    {
        var directory = Directory.CreateDirectory(DirectoryPath);
        if (directory.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Agent data directory must not be a symbolic link.");
        var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true, false);
        foreach (var sid in Writers()) acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null), FileSystemRights.ReadAndExecute, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        directory.SetAccessControl(acl);
    }
    public bool Exists => File.Exists(IdentityPath);
    public Identity Load()
    {
        var clear = ProtectedData.Unprotect(File.ReadAllBytes(IdentityPath), null, DataProtectionScope.LocalMachine);
        try { return JsonSerializer.Deserialize<Identity>(clear, Protocol.Json) ?? throw new IOException("Invalid identity store."); }
        finally { CryptographicOperations.ZeroMemory(clear); }
    }
    public void Save(Identity identity) => SaveProtected("identity.dpapi", identity);
    public void SavePending(PendingResult result) => SaveProtected("pending-result.dpapi", result);
    public PendingResult? LoadPending()
    {
        var path = Path.Combine(DirectoryPath, "pending-result.dpapi"); if (!File.Exists(path)) return null;
        var clear = ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.LocalMachine);
        try { return JsonSerializer.Deserialize<PendingResult>(clear, Protocol.Json) ?? throw new IOException("Invalid pending result."); } finally { CryptographicOperations.ZeroMemory(clear); }
    }
    public void ClearPending() => File.Delete(Path.Combine(DirectoryPath, "pending-result.dpapi"));
    private void SaveProtected<T>(string filename, T value)
    {
        var clear = JsonSerializer.SerializeToUtf8Bytes(value, Protocol.Json);
        byte[] encrypted;
        try { encrypted = ProtectedData.Protect(clear, null, DataProtectionScope.LocalMachine); }
        finally { CryptographicOperations.ZeroMemory(clear); }
        var temporary = Path.Combine(DirectoryPath, Guid.NewGuid() + ".tmp");
        try
        {
            using (File.Create(temporary)) { }
            var acl = new FileSecurity(); acl.SetAccessRuleProtection(true, false);
            foreach (var sid in Writers()) acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, AccessControlType.Allow));
            new FileInfo(temporary).SetAccessControl(acl);
            File.WriteAllBytes(temporary, encrypted); File.Move(temporary, Path.Combine(DirectoryPath, filename), true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public void Status(LocalStatus status)
    {
        var temporary = Path.Combine(DirectoryPath, "status-" + Guid.NewGuid() + ".tmp");
        try { File.WriteAllBytes(temporary, JsonSerializer.SerializeToUtf8Bytes(status, Protocol.Json)); File.Move(temporary, StatusPath, true); }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
