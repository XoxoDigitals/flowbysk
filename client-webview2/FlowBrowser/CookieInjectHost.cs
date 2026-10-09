using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace FlowBrowser;

/// <summary>
/// v5: inject admin-uploaded Google cookies into the Flow WebView2 profile,
/// verify SHA-256 value hashes, and support wipe-on-failure.
/// </summary>
static class CookieInjectHost
{
    public static string Sha256Hex(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value ?? ""));
        var sb = new StringBuilder(bytes.Length * 2);
        foreach (var b in bytes) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }

    public static async Task<object> InjectAsync(CoreWebView2 webView, JsonElement payload)
    {
        if (webView == null) throw new InvalidOperationException("Flow WebView is not ready.");
        if (!payload.TryGetProperty("cookies", out var cookiesEl) || cookiesEl.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException("injectCookies requires a cookies array.");

        var manager = webView.CookieManager;
        var written = new List<(string Url, string Name, string ValueHash, string? Domain, string Path)>();
        var failures = new List<string>();

        foreach (var item in cookiesEl.EnumerateArray())
        {
            try
            {
                var name = item.GetProperty("name").GetString() ?? "";
                var value = item.GetProperty("value").GetString() ?? "";
                var url = item.TryGetProperty("url", out var urlEl) ? urlEl.GetString() : null;
                var path = item.TryGetProperty("path", out var pathEl) ? pathEl.GetString() ?? "/" : "/";
                var secure = item.TryGetProperty("secure", out var secEl) && secEl.ValueKind == JsonValueKind.True;
                var httpOnly = item.TryGetProperty("httpOnly", out var httpEl) && httpEl.ValueKind == JsonValueKind.True;
                string? domain = null;
                if (item.TryGetProperty("domain", out var domEl) && domEl.ValueKind == JsonValueKind.String)
                    domain = domEl.GetString();

                if (string.IsNullOrWhiteSpace(url))
                {
                    var host = (domain ?? "google.com").TrimStart('.');
                    url = "https://" + host + (path.StartsWith("/") ? path : "/" + path);
                }

                var expectedHash = item.TryGetProperty("valueHash", out var hashEl)
                    ? hashEl.GetString()
                    : Sha256Hex(value);
                if (!string.Equals(Sha256Hex(value), expectedHash, StringComparison.OrdinalIgnoreCase))
                {
                    failures.Add($"{name}: valueHash mismatch before write");
                    continue;
                }

                var cookie = manager.CreateCookie(name, value, domain ?? new Uri(url!).Host, path);
                cookie.IsSecure = secure;
                cookie.IsHttpOnly = httpOnly;

                if (item.TryGetProperty("sameSite", out var ssEl) && ssEl.ValueKind == JsonValueKind.String)
                {
                    var ss = ssEl.GetString() ?? "Lax";
                    cookie.SameSite = ss.Equals("None", StringComparison.OrdinalIgnoreCase) ||
                                     ss.Equals("no_restriction", StringComparison.OrdinalIgnoreCase)
                        ? CoreWebView2CookieSameSiteKind.None
                        : ss.Equals("Strict", StringComparison.OrdinalIgnoreCase)
                            ? CoreWebView2CookieSameSiteKind.Strict
                            : CoreWebView2CookieSameSiteKind.Lax;
                }

                if (item.TryGetProperty("expires", out var expEl) && expEl.ValueKind == JsonValueKind.Number)
                {
                    var epoch = expEl.GetDouble();
                    if (epoch > 0)
                        cookie.Expires = DateTimeOffset.FromUnixTimeSeconds((long)epoch).UtcDateTime;
                }
                else if (item.TryGetProperty("expirationDate", out var exp2) && exp2.ValueKind == JsonValueKind.Number)
                {
                    var epoch = exp2.GetDouble();
                    if (epoch > 0)
                        cookie.Expires = DateTimeOffset.FromUnixTimeSeconds((long)epoch).UtcDateTime;
                }

                manager.AddOrUpdateCookie(cookie);
                written.Add((url!, name, expectedHash ?? Sha256Hex(value), domain, path));
            }
            catch (Exception ex)
            {
                var n = item.TryGetProperty("name", out var ne) ? ne.GetString() : "?";
                failures.Add($"{n}: {ex.Message}");
            }
        }

        if (failures.Count > 0)
        {
            return new
            {
                success = false,
                error = $"{failures.Count} cookies failed. {failures[0]}",
                failures,
                written = written.Count
            };
        }

        // Readback verify by name + SHA-256
        var verifyIssues = new List<string>();
        foreach (var w in written)
        {
            try
            {
                var list = await manager.GetCookiesAsync(w.Url);
                var match = list.FirstOrDefault(c =>
                    c.Name == w.Name &&
                    string.Equals(Sha256Hex(c.Value), w.ValueHash, StringComparison.OrdinalIgnoreCase));
                if (match == null)
                    verifyIssues.Add($"{w.Name}: missing or hash mismatch after write");
            }
            catch (Exception ex)
            {
                verifyIssues.Add($"{w.Name}: readback failed ({ex.Message})");
            }
        }

        if (verifyIssues.Count > 0)
        {
            return new
            {
                success = false,
                error = $"Chrome did not retain cookies. {verifyIssues[0]}",
                failures = verifyIssues,
                written = written.Count
            };
        }

        return new { success = true, written = written.Count };
    }

    /// <summary>
    /// Per-run temp Flow profile folder (deleted by caller on exit). Used when FLOW_V5_EPHEMERAL=1.
    /// </summary>
    public static string CreateEphemeralFlowProfile()
    {
        var dir = Path.Combine(Path.GetTempPath(), "FlowBrowserV5", Guid.NewGuid().ToString("N"), "flow");
        Directory.CreateDirectory(dir);
        return dir;
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
