using System.IO;

namespace FlowBrowser;

/// <summary>
/// WebView2 user-data folders. v6.1+: durable under LocalAppData (DataPaths).
/// TEMP GUID profiles are no longer used so Google cookies survive EXE close.
/// </summary>
static class RuntimeProfiles
{
    public static string CreateShell()
    {
        Directory.CreateDirectory(DataPaths.ShellProfile);
        return DataPaths.ShellProfile;
    }

    public static string CreateFlow()
    {
        Directory.CreateDirectory(DataPaths.FlowProfile);
        return DataPaths.FlowProfile;
    }

    /// <summary>
    /// Best-effort cleanup of leftover TEMP v6 ephemeral profile folders (GUID dirs).
    /// Never delete ui-* — WwwExtractor stores the embedded shell there.
    /// </summary>
    public static void CleanupLegacyTempProfiles()
    {
        try
        {
            var root = Path.Combine(Path.GetTempPath(), "FlowBrowserV6");
            if (!Directory.Exists(root)) return;
            foreach (var dir in Directory.EnumerateDirectories(root))
            {
                var name = Path.GetFileName(dir);
                // Active / cached www extract for virtual-host mapping
                if (name.StartsWith("ui-", StringComparison.OrdinalIgnoreCase))
                    continue;
                // Old ephemeral layout: {guid}\shell|flow
                TryDeleteDirectory(dir);
            }
        }
        catch { /* ignore */ }
    }

    public static void TryDeleteDirectory(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path)) return;
        try
        {
            Directory.Delete(path, recursive: true);
        }
        catch
        {
            try
            {
                foreach (var f in Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories))
                {
                    try { File.SetAttributes(f, FileAttributes.Normal); File.Delete(f); } catch { }
                }
            }
            catch { }
        }
    }
}
