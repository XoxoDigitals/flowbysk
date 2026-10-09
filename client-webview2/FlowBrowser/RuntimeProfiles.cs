using System.IO;

namespace FlowBrowser;

/// <summary>v6 ephemeral WebView2 profile folders under %TEMP%\FlowBrowserV6 (wiped on close).</summary>
static class RuntimeProfiles
{
    public static string Create(string leaf)
    {
        var dir = Path.Combine(Path.GetTempPath(), "FlowBrowserV6", Guid.NewGuid().ToString("N"), leaf);
        Directory.CreateDirectory(dir);
        DataPaths.TryHide(dir);
        try
        {
            var parent = Path.GetDirectoryName(dir);
            if (parent != null) DataPaths.TryHide(parent);
            DataPaths.TryHide(Path.Combine(Path.GetTempPath(), "FlowBrowserV6"));
        }
        catch { /* ignore */ }
        return dir;
    }

    public static string CreateShell() => Create("shell");
    public static string CreateFlow() => Create("flow");

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
