using System.IO;
using System.Text.RegularExpressions;

namespace FlowBrowser;

/// <summary>
/// WebView2 user-data folders. Durable LocalAppData profiles (cookies survive restart);
/// legacy per-run TEMP GUID profiles are purged.
/// </summary>
static class RuntimeProfiles
{
    static readonly Regex GuidName = new("^[0-9a-fA-F]{32}$|^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$",
        RegexOptions.Compiled);

    public static string CreateShell()
    {
        var overrideRoot = Environment.GetEnvironmentVariable("FLOW_PROFILE_OVERRIDE");
        if (!string.IsNullOrWhiteSpace(overrideRoot))
        {
            var p = Path.Combine(overrideRoot, "shell");
            Directory.CreateDirectory(p);
            return p;
        }
        DataPaths.EnsureDurableProfiles();
        return DataPaths.ShellProfile;
    }

    public static string CreateFlow()
    {
        var overrideRoot = Environment.GetEnvironmentVariable("FLOW_PROFILE_OVERRIDE");
        if (!string.IsNullOrWhiteSpace(overrideRoot))
        {
            var p = Path.Combine(overrideRoot, "flow");
            Directory.CreateDirectory(p);
            return p;
        }
        DataPaths.EnsureDurableProfiles();
        return DataPaths.FlowProfile;
    }

    /// <summary>Delete GUID-named leftovers in %TEMP%\FlowBrowserV6 (never ui-*).</summary>
    public static void CleanupLegacyTempProfiles()
    {
        try
        {
            var baseDir = Path.Combine(Path.GetTempPath(), "FlowBrowserV6");
            if (!Directory.Exists(baseDir)) return;
            foreach (var dir in Directory.EnumerateDirectories(baseDir))
            {
                var name = Path.GetFileName(dir);
                if (name.StartsWith("ui-", StringComparison.OrdinalIgnoreCase)) continue;
                if (!GuidName.IsMatch(name)) continue;
                try { Directory.Delete(dir, true); } catch { /* in use / best-effort */ }
            }
        }
        catch { /* best-effort */ }
    }
}
