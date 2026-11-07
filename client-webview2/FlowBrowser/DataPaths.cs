using System.IO;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

namespace FlowBrowser;

/// <summary>
/// Durable per-user vault under %LocalAppData%\FlowCreator\v\{guid}
/// (not Windows\Caches — Disk Cleanup was purging sessions there).
/// </summary>
static class DataPaths
{
    static string? _root;
    static bool _profilesInitialized;
    static readonly HashSet<string> HardenedDirs = new(StringComparer.OrdinalIgnoreCase);
    static readonly object Gate = new();

    /// <summary>
    /// e.g. %LocalAppData%\FlowCreator\v\{a1b2c3d4-...}
    /// </summary>
    public static string Root
    {
        get
        {
            lock (Gate)
            {
                if (_root != null) return _root;
                var guid = StableVaultGuid();
                _root = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "FlowCreator",
                    "v",
                    guid);
                Directory.CreateDirectory(_root);
                TryHide(_root);
                return _root;
            }
        }
    }

    /// <summary>Previous vault under Microsoft\Windows\Caches\{same-guid} — migrate once.</summary>
    public static string LegacyCachesRoot
    {
        get
        {
            var guid = StableVaultGuid();
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Microsoft",
                "Windows",
                "Caches",
                guid);
        }
    }

    public static string SecureDir => Path.Combine(Root, "k");
    public static string SecureSessionPath => Path.Combine(SecureDir, "session.bin");
    public static string DataRoot => Path.Combine(Root, "d");
    public static string ShellProfile => Path.Combine(DataRoot, "s");
    public static string FlowProfile => Path.Combine(DataRoot, "f");
    public static string UiBase => Path.Combine(Root, "u");
    public static string UiRoot(string version) => Path.Combine(UiBase, version);

    public static string LegacyLocalFlowBrowser =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FlowBrowser");

    public static string LegacyRoamingFlowBrowser =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "FlowBrowser");

    public static string LegacySecureSession =>
        Path.Combine(LegacyLocalFlowBrowser, ".secure", "session.bin");

    public static string LegacyPlainConfig =>
        Path.Combine(LegacyRoamingFlowBrowser, "flow_client_config.json");

    public static string LegacyDataRoot =>
        Path.Combine(LegacyLocalFlowBrowser, ".data");

    /// <summary>Stable GUID so path does not change between launches (same seed as former Caches vault).</summary>
    static string StableVaultGuid()
    {
        var seed = string.Join("|",
            "fb.cache.v1",
            Environment.UserName,
            Environment.MachineName,
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(seed));
        var bytes = new byte[16];
        Buffer.BlockCopy(hash, 0, bytes, 0, 16);
        // RFC 4122 variant bits
        bytes[7] = (byte)((bytes[7] & 0x0f) | 0x40);
        bytes[8] = (byte)((bytes[8] & 0x3f) | 0x80);
        return new Guid(bytes).ToString("D");
    }

    /// <summary>Session vault + durable WebView profiles (cookies survive app close).</summary>
    public static void EnsureDurableProfiles()
    {
        lock (Gate)
        {
            if (_profilesInitialized &&
                Directory.Exists(SecureDir) &&
                Directory.Exists(ShellProfile) &&
                Directory.Exists(FlowProfile) &&
                Directory.Exists(UiBase))
            {
                return;
            }

            Directory.CreateDirectory(SecureDir);
            Directory.CreateDirectory(ShellProfile);
            Directory.CreateDirectory(FlowProfile);
            Directory.CreateDirectory(UiBase);
            TryHide(Root);
            TryHide(SecureDir);
            TryHide(DataRoot);
            TryUnhide(ShellProfile);
            TryUnhide(FlowProfile);
            TryHide(UiBase);
            HardenVaultDirectory(SecureDir);
            _profilesInitialized = true;
        }
    }

    /// <summary>Legacy name — now creates durable profiles (does not wipe DataRoot).</summary>
    public static void EnsureSessionOnly() => EnsureDurableProfiles();

    public static void EnsureTree() => EnsureDurableProfiles();

    /// <summary>
    /// Migrate from Windows\Caches vault and old FlowBrowser brand folders into FlowCreator\v.
    /// </summary>
    public static void MigrateFromLegacy()
    {
        try
        {
            EnsureTree();
            MigrateFromCachesVault();

            // Session blob from brand folder
            if (!File.Exists(SecureSessionPath) && File.Exists(LegacySecureSession))
            {
                Directory.CreateDirectory(SecureDir);
                File.Copy(LegacySecureSession, SecureSessionPath, overwrite: false);
                HardenVaultDirectory(SecureDir);
            }

            // WebView profiles (only if new empty)
            TryMoveDirIfEmpty(
                Path.Combine(LegacyDataRoot, "f"),
                FlowProfile);
            TryMoveDirIfEmpty(
                Path.Combine(LegacyDataRoot, "s"),
                ShellProfile);

            TryMoveDirIfEmpty(
                Path.Combine(LegacyLocalFlowBrowser, "flow-profile"),
                FlowProfile);
            TryMoveDirIfEmpty(
                Path.Combine(LegacyLocalFlowBrowser, "shell-profile"),
                ShellProfile);
        }
        catch { /* best-effort */ }

        TryDeleteTree(LegacyLocalFlowBrowser);
        TryDeleteTree(LegacyRoamingFlowBrowser);
    }

    static void MigrateFromCachesVault()
    {
        try
        {
            var oldRoot = LegacyCachesRoot;
            if (!Directory.Exists(oldRoot)) return;
            if (string.Equals(
                    Path.GetFullPath(oldRoot).TrimEnd('\\'),
                    Path.GetFullPath(Root).TrimEnd('\\'),
                    StringComparison.OrdinalIgnoreCase))
                return;

            var oldSecure = Path.Combine(oldRoot, "k", "session.bin");
            var oldFlow = Path.Combine(oldRoot, "d", "f");
            var oldShell = Path.Combine(oldRoot, "d", "s");

            if (!File.Exists(SecureSessionPath) && File.Exists(oldSecure))
            {
                Directory.CreateDirectory(SecureDir);
                File.Copy(oldSecure, SecureSessionPath, overwrite: false);
            }

            TryMoveDirIfEmpty(oldFlow, FlowProfile);
            TryMoveDirIfEmpty(oldShell, ShellProfile);

            // Only delete old Caches vault after we have session or profiles in the new place
            var migrated =
                File.Exists(SecureSessionPath) ||
                Directory.GetFileSystemEntries(FlowProfile).Length > 0 ||
                Directory.GetFileSystemEntries(ShellProfile).Length > 0;
            if (migrated)
                TryDeleteTree(oldRoot);
        }
        catch { /* best-effort */ }
    }

    /// <summary>Hidden + System + ACL: current user + SYSTEM only (no inherited Everyone).</summary>
    public static void HardenVaultDirectory(string path)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(path)) return;
            Directory.CreateDirectory(path);
            TryHide(path);

            var full = Path.GetFullPath(path).TrimEnd('\\');
            lock (Gate)
            {
                if (!HardenedDirs.Add(full))
                    return;
            }

            // Never run recursive NTFS SetAccessControl on WebView2 profile or UI trees (thousands of files).
            // Only harden SecureDir (contains only session.bin and flow_cookies.bin) once.
            var secureFull = Path.GetFullPath(SecureDir).TrimEnd('\\');
            if (!full.Equals(secureFull, StringComparison.OrdinalIgnoreCase))
                return;

            var aclMarker = Path.Combine(full, ".acl_ok");
            if (File.Exists(aclMarker))
                return;

            var di = new DirectoryInfo(full);
            var sec = di.GetAccessControl();
            sec.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);

            var user = WindowsIdentity.GetCurrent().User;
            if (user != null)
            {
                sec.PurgeAccessRules(user);
                sec.AddAccessRule(new FileSystemAccessRule(
                    user,
                    FileSystemRights.FullControl,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                    PropagationFlags.None,
                    AccessControlType.Allow));
            }

            var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
            sec.PurgeAccessRules(system);
            sec.AddAccessRule(new FileSystemAccessRule(
                system,
                FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None,
                AccessControlType.Allow));

            di.SetAccessControl(sec);
            File.WriteAllText(aclMarker, "1");
            TryHide(aclMarker);
        }
        catch { /* ACL may fail on some locked-down machines — hide still applied */ }
    }

    static void TryMoveDirIfEmpty(string from, string to)
    {
        try
        {
            if (!Directory.Exists(from)) return;
            Directory.CreateDirectory(to);
            var toEmpty = Directory.GetFileSystemEntries(to).Length == 0;
            if (!toEmpty) return;

            foreach (var entry in Directory.GetFileSystemEntries(from))
            {
                var name = Path.GetFileName(entry);
                var dest = Path.Combine(to, name);
                if (Directory.Exists(entry))
                    Directory.Move(entry, dest);
                else
                    File.Move(entry, dest);
            }
        }
        catch { /* ignore */ }
    }

    static void TryDeleteTree(string path)
    {
        try
        {
            if (Directory.Exists(path))
                Directory.Delete(path, recursive: true);
        }
        catch { /* in use / ACL */ }
    }

    public static void TryHide(string path)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path) && !File.Exists(path)) return;
            // Directories: Hidden+System. Files: Hidden only — System files block overwrite (session.bin).
            var di = new DirectoryInfo(path);
            if (di.Exists)
                di.Attributes |= FileAttributes.Hidden | FileAttributes.System;
            else
            {
                var fi = new FileInfo(path);
                fi.Attributes = (fi.Attributes | FileAttributes.Hidden) & ~FileAttributes.System;
            }
        }
        catch { /* ignore */ }
    }

    public static void TryUnhide(string path)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path)) return;
            var di = new DirectoryInfo(path);
            if (di.Exists)
                di.Attributes &= ~(FileAttributes.Hidden | FileAttributes.System);
        }
        catch { /* ignore */ }
    }
}
