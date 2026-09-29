using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace FlowBrowser;

/// <summary>
/// Opaque per-user data root under Microsoft\Windows\Caches\{guid}
/// instead of the brand-named FlowBrowser folder.
/// </summary>
static class DataPaths
{
    static string? _root;
    static readonly object Gate = new();

    /// <summary>
    /// e.g. %LocalAppData%\Microsoft\Windows\Caches\{a1b2c3d4-...}
    /// </summary>
    public static string Root
    {
        get
        {
            lock (Gate)
            {
                if (_root != null) return _root;
                var guid = StableCacheGuid();
                _root = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Microsoft",
                    "Windows",
                    "Caches",
                    guid);
                Directory.CreateDirectory(_root);
                TryHide(_root);
                return _root;
            }
        }
    }

    public static string SecureDir => Path.Combine(Root, "k");
    public static string SecureSessionPath => Path.Combine(SecureDir, "session.bin");
    public static string DataRoot => Path.Combine(Root, "d");
    public static string ShellProfile => Path.Combine(DataRoot, "s");
    public static string FlowProfile => Path.Combine(DataRoot, "f");
    public static string UiRoot(string version) => Path.Combine(Root, "u", version);

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

    /// <summary>Stable GUID so path does not change between launches.</summary>
    static string StableCacheGuid()
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

    public static void EnsureTree()
    {
        Directory.CreateDirectory(SecureDir);
        Directory.CreateDirectory(DataRoot);
        Directory.CreateDirectory(ShellProfile);
        Directory.CreateDirectory(FlowProfile);
        TryHide(Root);
        TryHide(SecureDir);
        TryHide(DataRoot);
        TryHide(ShellProfile);
        TryHide(FlowProfile);
    }

    /// <summary>Move session + profiles from old FlowBrowser paths, then delete brand folder.</summary>
    public static void MigrateFromLegacy()
    {
        try
        {
            EnsureTree();

            // Session blob
            if (!File.Exists(SecureSessionPath) && File.Exists(LegacySecureSession))
            {
                Directory.CreateDirectory(SecureDir);
                File.Copy(LegacySecureSession, SecureSessionPath, overwrite: false);
            }

            // WebView profiles (only if new empty)
            TryMoveDirIfEmpty(
                Path.Combine(LegacyDataRoot, "f"),
                FlowProfile);
            TryMoveDirIfEmpty(
                Path.Combine(LegacyDataRoot, "s"),
                ShellProfile);

            // Old obvious flow-profile / shell-profile
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

    static void TryMoveDirIfEmpty(string from, string to)
    {
        try
        {
            if (!Directory.Exists(from)) return;
            Directory.CreateDirectory(to);
            var toEmpty = Directory.GetFileSystemEntries(to).Length == 0;
            if (!toEmpty) return;

            // Move contents
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
            if (!Directory.Exists(path) && !File.Exists(path)) return;
            var di = new DirectoryInfo(path);
            if (di.Exists)
                di.Attributes |= FileAttributes.Hidden | FileAttributes.System;
            else
            {
                var fi = new FileInfo(path);
                fi.Attributes |= FileAttributes.Hidden | FileAttributes.System;
            }
        }
        catch { /* ignore */ }
    }
}
