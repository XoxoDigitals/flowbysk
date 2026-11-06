using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;

namespace FlowBrowser;

/// <summary>
/// Release: decrypt embedded AES-GCM www.vault into the durable vault UI folder.
/// Debug / folder-portable: prefer a www folder next to the binary.
/// </summary>
static class WwwExtractor
{
    const string EmbeddedVaultName = "FlowBrowser.www.vault";
    const string LegacyEmbeddedZipName = "FlowBrowser.www.zip";

    static string? _wwwExtractRoot;
    static byte[]? _cachedZipBytes;
    static readonly object Gate = new();

    public static string? TempWwwRoot
    {
        get { lock (Gate) return _wwwExtractRoot; }
    }

    static byte[] GetVaultZipBytes()
    {
        lock (Gate)
        {
            if (_cachedZipBytes != null)
                return _cachedZipBytes;

            var asm = Assembly.GetExecutingAssembly();
            using var stream = asm.GetManifestResourceStream(EmbeddedVaultName);
            if (stream != null)
            {
                using var ms = new MemoryStream();
                stream.CopyTo(ms);
                _cachedZipBytes = VaultCrypto.OpenWwwVault(ms.ToArray());
                return _cachedZipBytes;
            }

            using var legacy = asm.GetManifestResourceStream(LegacyEmbeddedZipName)
                ?? throw new FileNotFoundException(
                    "Embedded www.vault not found. Rebuild Release with pack-www + encrypt-www.");
            using var lms = new MemoryStream();
            legacy.CopyTo(lms);
            _cachedZipBytes = lms.ToArray();
            return _cachedZipBytes;
        }
    }

    /// <summary>
    /// Reads a file directly from the encrypted in-memory www.vault ZIP without touching disk.
    /// Falls back to disk candidates only in Debug mode.
    /// </summary>
    public static string? ReadEmbeddedText(string relativePath)
    {
        var norm = relativePath.Replace('\\', '/').TrimStart('/');
        try
        {
            var zipBytes = GetVaultZipBytes();
            using var zipMs = new MemoryStream(zipBytes, writable: false);
            using var archive = new ZipArchive(zipMs, ZipArchiveMode.Read);
            foreach (var entry in archive.Entries)
            {
                var entryPath = entry.FullName.Replace('\\', '/').TrimStart('/');
                if (entryPath.Equals(norm, StringComparison.OrdinalIgnoreCase) ||
                    entryPath.Equals("www/" + norm, StringComparison.OrdinalIgnoreCase))
                {
                    using var sr = new StreamReader(entry.Open(), System.Text.Encoding.UTF8);
                    return sr.ReadToEnd().TrimStart('\uFEFF');
                }
            }
        }
        catch { /* fall back to disk if needed */ }

        foreach (var c in DiskCandidates())
        {
            var p = Path.Combine(c, relativePath.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(p))
                return File.ReadAllText(p).TrimStart('\uFEFF');
        }
        return null;
    }

    static void ScrubMemoryOnlyScriptsFromDisk(string root)
    {
        string[] memoryOnlyRelPaths =
        {
            Path.Combine("scripts", "flow-inject.js"),
            Path.Combine("scripts", "veo-content-bundle.js"),
            Path.Combine("extensions", "veo-auto", "veo-content-bundle.js")
        };
        foreach (var rel in memoryOnlyRelPaths)
        {
            try
            {
                var full = Path.Combine(root, rel);
                if (File.Exists(full))
                    File.Delete(full);
            }
            catch { /* ignore */ }
        }
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
        var zipBytes = GetVaultZipBytes();

        var hash = Convert.ToHexString(SHA256.HashData(zipBytes));
        // Durable vault UI path — not %TEMP% (survives Disk Cleanup of temp files)
        DataPaths.EnsureDurableProfiles();
        var root = DataPaths.UiRoot("www-" + hash[..16].ToLowerInvariant());

        var marker = Path.Combine(root, ".extracted");
        var shell = Path.Combine(root, "ui", "app-shell.html");

        if (File.Exists(marker) && File.Exists(shell))
        {
            var prev = File.ReadAllText(marker).Trim();
            if (prev.Equals(hash, StringComparison.OrdinalIgnoreCase))
            {
                ScrubMemoryOnlyScriptsFromDisk(root);
                lock (Gate) _wwwExtractRoot = root;
                DataPaths.HardenVaultDirectory(root);
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

            ScrubMemoryOnlyScriptsFromDisk(root);
            File.WriteAllText(marker, hash);
            DataPaths.HardenVaultDirectory(root);
            DataPaths.HardenVaultDirectory(DataPaths.UiBase);
            lock (Gate) _wwwExtractRoot = root;
            return root;
        }
        catch
        {
            try { if (Directory.Exists(tmp)) Directory.Delete(tmp, true); } catch { /* ignore */ }
            throw;
        }
    }

    /// <summary>
    /// Clean up stale UI folders on exit while keeping the current version's scrubbed UI cache
    /// so subsequent launches start instantaneously. Sensitive scripts (flow-inject.js, veo-content-bundle.js)
    /// are never stored on disk (scrubbed immediately on extraction).
    /// </summary>
    public static void WipeTempWww()
    {
        string? activeRoot;
        lock (Gate)
        {
            activeRoot = _wwwExtractRoot;
            _wwwExtractRoot = null;
        }
        try
        {
            if (!string.IsNullOrWhiteSpace(activeRoot) && Directory.Exists(activeRoot))
                ScrubMemoryOnlyScriptsFromDisk(activeRoot);
            if (Directory.Exists(DataPaths.UiBase))
            {
                var activeFull = !string.IsNullOrWhiteSpace(activeRoot)
                    ? Path.GetFullPath(activeRoot).TrimEnd('\\')
                    : "";
                foreach (var dir in Directory.EnumerateDirectories(DataPaths.UiBase, "www-*"))
                {
                    var dirFull = Path.GetFullPath(dir).TrimEnd('\\');
                    if (!string.IsNullOrEmpty(activeFull) &&
                        dirFull.Equals(activeFull, StringComparison.OrdinalIgnoreCase))
                        continue;
                    CookieInjectHost.TryDeleteDirectory(dir);
                }
            }
        }
        catch { /* ignore */ }
        try
        {
            var baseDir = Path.Combine(Path.GetTempPath(), "FlowBrowserV6");
            if (!Directory.Exists(baseDir)) return;
            foreach (var dir in Directory.EnumerateDirectories(baseDir, "ui-*"))
                CookieInjectHost.TryDeleteDirectory(dir);
            try
            {
                if (Directory.GetFileSystemEntries(baseDir).Length == 0)
                    Directory.Delete(baseDir, false);
            }
            catch { /* ignore */ }
        }
        catch { /* ignore */ }
    }
}
