using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;

namespace FlowBrowser;

/// <summary>
/// Ensures UI assets are available on disk. Prefers a www folder next to the
/// binary (dev / folder portable). For single-file builds, extracts the
/// embedded www.zip into LocalAppData (re-extracts when the zip hash changes).
/// </summary>
static class WwwExtractor
{
    const string EmbeddedZipName = "FlowBrowser.www.zip";

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
        var baseDir = AppContext.BaseDirectory;
        yield return Path.Combine(baseDir, "www");
        yield return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "www");
        var dev = Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "www"));
        yield return dev;
    }

    static string ExtractEmbeddedWww()
    {
        var asm = Assembly.GetExecutingAssembly();
        using var stream = asm.GetManifestResourceStream(EmbeddedZipName)
            ?? throw new FileNotFoundException(
                "Embedded www.zip not found. Rebuild with www.zip embedded, or place a www folder next to the exe.");

        using var ms = new MemoryStream();
        stream.CopyTo(ms);
        var zipBytes = ms.ToArray();
        var hash = Convert.ToHexString(SHA256.HashData(zipBytes));

        var version = asm.GetName().Version?.ToString(3) ?? "0.0.0";
        var root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FlowBrowser",
            ".data",
            "ui",
            version);
        var marker = Path.Combine(root, ".extracted");
        var shell = Path.Combine(root, "ui", "app-shell.html");

        if (File.Exists(marker) && File.Exists(shell))
        {
            var prev = File.ReadAllText(marker).Trim();
            if (prev.Equals(hash, StringComparison.OrdinalIgnoreCase))
            {
                TryDeleteLegacyUiWww();
                return root;
            }
        }

        var tmp = root + ".tmp";
        if (Directory.Exists(tmp))
            Directory.Delete(tmp, true);
        Directory.CreateDirectory(tmp);

        ms.Position = 0;
        ZipFile.ExtractToDirectory(ms, tmp);

        var extractedRoot = File.Exists(Path.Combine(tmp, "ui", "app-shell.html"))
            ? tmp
            : Path.Combine(tmp, "www");

        if (!File.Exists(Path.Combine(extractedRoot, "ui", "app-shell.html")))
            throw new DirectoryNotFoundException("www.zip did not contain ui/app-shell.html.");

        var staging = root + ".staging";
        if (Directory.Exists(staging))
            Directory.Delete(staging, true);

        if (extractedRoot == tmp)
            Directory.Move(tmp, staging);
        else
        {
            Directory.Move(extractedRoot, staging);
            if (Directory.Exists(tmp))
                Directory.Delete(tmp, true);
        }

        if (Directory.Exists(root))
            Directory.Delete(root, true);
        Directory.CreateDirectory(Path.GetDirectoryName(root)!);
        Directory.Move(staging, root);
        File.WriteAllText(marker, hash);
        try
        {
            var di = new DirectoryInfo(root);
            di.Attributes |= FileAttributes.Hidden | FileAttributes.System;
            var parent = Directory.GetParent(root)?.Parent; // .data
            if (parent != null)
                parent.Attributes |= FileAttributes.Hidden | FileAttributes.System;
        }
        catch { /* ignore */ }

        TryDeleteLegacyUiWww();
        return root;
    }

    /// <summary>Remove old plaintext extract path used before .data/ui.</summary>
    static void TryDeleteLegacyUiWww()
    {
        try
        {
            var legacy = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "FlowBrowser",
                "ui-www");
            if (Directory.Exists(legacy))
                Directory.Delete(legacy, recursive: true);
        }
        catch { /* ignore in-use / ACL */ }
    }
}
