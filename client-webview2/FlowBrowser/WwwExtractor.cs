using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;

namespace FlowBrowser;

/// <summary>
/// Release: decrypt embedded AES-GCM www.vault into a hidden temp folder (wiped on exit).
/// Debug / folder-portable: prefer a www folder next to the binary.
/// </summary>
static class WwwExtractor
{
    const string EmbeddedVaultName = "FlowBrowser.www.vault";
    const string LegacyEmbeddedZipName = "FlowBrowser.www.zip";

    static string? _tempWwwRoot;
    static readonly object Gate = new();

    public static string? TempWwwRoot
    {
        get { lock (Gate) return _tempWwwRoot; }
    }

    public static string ResolveWwwRoot()
    {
        foreach (var c in DiskCandidates())
        {
            if (File.Exists(Path.Combine(c, "ui", "app-shell.html")))
                return c;
        }

        return ExtractEmbeddedWww();
    }

    static IEnumerable<string> DiskCandidates()
    {
#if DEBUG
        var baseDir = AppContext.BaseDirectory;
        yield return Path.Combine(baseDir, "www");
        yield return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "www");
        var dev = Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "www"));
        yield return dev;
#else
        // Release single-file: never leave readable www next to the EXE.
        yield break;
#endif
    }

    static string ExtractEmbeddedWww()
    {
        var asm = Assembly.GetExecutingAssembly();
        byte[] zipBytes;

        using (var stream = asm.GetManifestResourceStream(EmbeddedVaultName))
        {
            if (stream != null)
            {
                using var ms = new MemoryStream();
                stream.CopyTo(ms);
                zipBytes = VaultCrypto.OpenWwwVault(ms.ToArray());
            }
            else
            {
                using var legacy = asm.GetManifestResourceStream(LegacyEmbeddedZipName)
                    ?? throw new FileNotFoundException(
                        "Embedded www.vault not found. Rebuild Release with pack-www + encrypt-www.");
                using var ms = new MemoryStream();
                legacy.CopyTo(ms);
                zipBytes = ms.ToArray();
            }
        }

        var hash = Convert.ToHexString(SHA256.HashData(zipBytes));
        var root = Path.Combine(
            Path.GetTempPath(),
            "FlowBrowserV6",
            "ui-" + hash[..16].ToLowerInvariant());

        var marker = Path.Combine(root, ".extracted");
        var shell = Path.Combine(root, "ui", "app-shell.html");

        if (File.Exists(marker) && File.Exists(shell))
        {
            var prev = File.ReadAllText(marker).Trim();
            if (prev.Equals(hash, StringComparison.OrdinalIgnoreCase))
            {
                lock (Gate) _tempWwwRoot = root;
                DataPaths.TryHide(root);
                DataPaths.TryHide(Path.GetDirectoryName(root)!);
                return root;
            }
        }

        var tmp = root + ".tmp";
        try
        {
            if (Directory.Exists(tmp))
                Directory.Delete(tmp, true);
            Directory.CreateDirectory(tmp);

            using (var zipMs = new MemoryStream(zipBytes))
                ZipFile.ExtractToDirectory(zipMs, tmp);

            var extractedRoot = File.Exists(Path.Combine(tmp, "ui", "app-shell.html"))
                ? tmp
                : Path.Combine(tmp, "www");

            if (!File.Exists(Path.Combine(extractedRoot, "ui", "app-shell.html")))
                throw new DirectoryNotFoundException("www vault did not contain ui/app-shell.html.");

            if (Directory.Exists(root))
                Directory.Delete(root, true);

            if (extractedRoot == tmp)
                Directory.Move(tmp, root);
            else
            {
                Directory.CreateDirectory(Path.GetDirectoryName(root)!);
                Directory.Move(extractedRoot, root);
                if (Directory.Exists(tmp))
                    Directory.Delete(tmp, true);
            }

            File.WriteAllText(marker, hash);
            DataPaths.TryHide(root);
            DataPaths.TryHide(Path.GetDirectoryName(root)!);
            lock (Gate) _tempWwwRoot = root;
            return root;
        }
        catch
        {
            try { if (Directory.Exists(tmp)) Directory.Delete(tmp, true); } catch { /* ignore */ }
            throw;
        }
    }

    public static void WipeTempWww()
    {
        string? root;
        lock (Gate)
        {
            root = _tempWwwRoot;
            _tempWwwRoot = null;
        }
        RuntimeProfiles.TryDeleteDirectory(root);
        // Best-effort: clear sibling ui-* leftovers under FlowBrowserV6
        try
        {
            var baseDir = Path.Combine(Path.GetTempPath(), "FlowBrowserV6");
            if (!Directory.Exists(baseDir)) return;
            foreach (var dir in Directory.EnumerateDirectories(baseDir, "ui-*"))
                RuntimeProfiles.TryDeleteDirectory(dir);
        }
        catch { /* ignore */ }
    }
}
