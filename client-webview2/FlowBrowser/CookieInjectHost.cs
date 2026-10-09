using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace FlowBrowser;

/// <summary>
/// v5: inject admin/extension-style Google cookies into the Flow WebView2 profile.
/// Accepts the same chrome.cookies.set-shaped payload as Flow by MK (url, name, value,
/// domain?, path, secure, httpOnly, sameSite, expirationDate/expires, hostOnly, valueHash).
/// </summary>
static class CookieInjectHost
{
    static readonly string[] VerifyOrigins =
    {
        "https://flow.google.com/",
        "https://labs.google/",
        "https://www.google.com/",
        "https://accounts.google.com/",
        "https://google.com/"
    };

    public static string Sha256Hex(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value ?? ""));
        var sb = new StringBuilder(bytes.Length * 2);
        foreach (var b in bytes) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }

    static bool ReadBool(JsonElement item, string name)
    {
        if (!item.TryGetProperty(name, out var el)) return false;
        return el.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => el.TryGetInt32(out var n) && n != 0,
            JsonValueKind.String => el.GetString() is "1" or "true" or "True",
            _ => false
        };
    }

    static double? ReadEpoch(JsonElement item)
    {
        if (item.TryGetProperty("expires", out var exp) && exp.ValueKind == JsonValueKind.Number)
            return exp.GetDouble();
        if (item.TryGetProperty("expirationDate", out var exp2) && exp2.ValueKind == JsonValueKind.Number)
            return exp2.GetDouble();
        return null;
    }

    static CoreWebView2CookieSameSiteKind MapSameSite(string? raw)
    {
        var ss = (raw ?? "lax").Trim().ToLowerInvariant().Replace('-', '_');
        if (ss is "none" or "no_restriction") return CoreWebView2CookieSameSiteKind.None;
        if (ss == "strict") return CoreWebView2CookieSameSiteKind.Strict;
        return CoreWebView2CookieSameSiteKind.Lax;
    }

    public static async Task<object> InjectAsync(CoreWebView2 webView, JsonElement payload)
    {
        if (webView == null) throw new InvalidOperationException("Flow WebView is not ready.");
        if (!payload.TryGetProperty("cookies", out var cookiesEl) || cookiesEl.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException("injectCookies requires a cookies array.");

        var manager = webView.CookieManager;
        var written = new List<(string Url, string Name, string ValueHash, bool HostOnly)>();
        var failures = new List<string>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        foreach (var item in cookiesEl.EnumerateArray())
        {
            string name = "?";
            try
            {
                name = item.TryGetProperty("name", out var nEl) ? (nEl.GetString() ?? "") : "";
                var value = item.TryGetProperty("value", out var vEl) ? (vEl.GetString() ?? "") : "";
                if (string.IsNullOrEmpty(name))
                {
                    failures.Add("(unnamed): missing name");
                    continue;
                }

                var path = item.TryGetProperty("path", out var pathEl) && pathEl.ValueKind == JsonValueKind.String
                    ? (pathEl.GetString() ?? "/")
                    : "/";
                if (string.IsNullOrEmpty(path) || !path.StartsWith('/')) path = "/";

                string? domainRaw = null;
                if (item.TryGetProperty("domain", out var domEl) && domEl.ValueKind == JsonValueKind.String)
                    domainRaw = domEl.GetString();

                var hostOnly = ReadBool(item, "hostOnly")
                    || name.StartsWith("__Host-", StringComparison.Ordinal)
                    || (domainRaw != null && !domainRaw.StartsWith('.'));

                // Extension-style URL: https://{cleanDomain}{path}
                var url = item.TryGetProperty("url", out var urlEl) && urlEl.ValueKind == JsonValueKind.String
                    ? urlEl.GetString()
                    : null;
                if (string.IsNullOrWhiteSpace(url))
                {
                    var host = (domainRaw ?? "google.com").TrimStart('.');
                    url = "https://" + host + path;
                }

                Uri uri;
                try { uri = new Uri(url!); }
                catch
                {
                    failures.Add($"{name}: invalid url {url}");
                    continue;
                }

                var expectedHash = item.TryGetProperty("valueHash", out var hashEl) && hashEl.ValueKind == JsonValueKind.String
                    ? hashEl.GetString()
                    : Sha256Hex(value);
                if (!string.Equals(Sha256Hex(value), expectedHash, StringComparison.OrdinalIgnoreCase))
                {
                    failures.Add($"{name}: valueHash mismatch before write");
                    continue;
                }

                var secure = ReadBool(item, "secure")
                    || name.StartsWith("__Host-", StringComparison.Ordinal)
                    || name.StartsWith("__Secure-", StringComparison.Ordinal);
                var httpOnly = ReadBool(item, "httpOnly");
                var sameSite = MapSameSite(
                    item.TryGetProperty("sameSite", out var ssEl) && ssEl.ValueKind == JsonValueKind.String
                        ? ssEl.GetString()
                        : null);
                if (sameSite == CoreWebView2CookieSameSiteKind.None) secure = true;

                // WebView2 CreateCookie Domain:
                // - host-only → exact host, no leading dot
                // - domain cookie → leading-dot form like ".google.com" (matches Chromium / extension exports)
                string domainForCreate;
                if (hostOnly)
                {
                    domainForCreate = string.IsNullOrWhiteSpace(domainRaw)
                        ? uri.Host
                        : domainRaw.TrimStart('.');
                }
                else
                {
                    var clean = (domainRaw ?? uri.Host).TrimStart('.');
                    domainForCreate = "." + clean;
                }

                var cookie = manager.CreateCookie(name, value, domainForCreate, path);
                cookie.IsSecure = secure;
                cookie.IsHttpOnly = httpOnly;
                cookie.SameSite = sameSite;

                var epoch = ReadEpoch(item);
                if (epoch is double e && e > now)
                {
                    cookie.Expires = DateTimeOffset.FromUnixTimeSeconds((long)e).UtcDateTime;
                }
                // else leave as session cookie (Expires unset)

                manager.AddOrUpdateCookie(cookie);
                written.Add((url!, name, expectedHash ?? Sha256Hex(value), hostOnly));
            }
            catch (Exception ex)
            {
                failures.Add($"{name}: {ex.Message}");
            }
        }

        if (written.Count == 0)
        {
            return new
            {
                success = false,
                error = failures.Count > 0
                    ? $"No cookies written. {failures[0]}"
                    : "No cookies written.",
                failures,
                written = 0
            };
        }

        // Give CookieManager a beat after bulk writes
        await Task.Delay(150);

        // Soft readback: confirm cookie appears under flow.google.com / related Google origins.
        // Do NOT wipe the whole batch for a single sibling miss (extension does exact-scope verify;
        // WebView2 GetCookiesAsync URI matching is looser and occasionally skips host-only rows).
        var verified = 0;
        var verifyIssues = new List<string>();
        foreach (var w in written)
        {
            var found = false;
            var origins = new List<string> { w.Url };
            origins.AddRange(VerifyOrigins);
            foreach (var origin in origins.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                try
                {
                    var list = await manager.GetCookiesAsync(origin);
                    if (list.Any(c =>
                            c.Name == w.Name &&
                            string.Equals(Sha256Hex(c.Value), w.ValueHash, StringComparison.OrdinalIgnoreCase)))
                    {
                        found = true;
                        break;
                    }
                }
                catch
                {
                    /* try next origin */
                }
            }

            if (found) verified++;
            else verifyIssues.Add($"{w.Name}: not visible yet under flow.google.com / google.com");
        }

        // Success if majority of cookies are visible (covers Flow). Hard-fail only when almost nothing stuck.
        var ok = verified > 0 && verified * 2 >= written.Count;
        if (!ok)
        {
            return new
            {
                success = false,
                error = verifyIssues.Count > 0
                    ? $"Cookies did not stick in Chromium. {verifyIssues[0]}"
                    : "Cookies did not stick in Chromium.",
                failures = verifyIssues.Concat(failures).ToList(),
                written = written.Count,
                verified
            };
        }

        return new
        {
            success = true,
            written = written.Count,
            verified,
            warnings = verifyIssues.Count > 0 ? verifyIssues : null,
            writeFailures = failures.Count > 0 ? failures : null
        };
    }

    public static string CreateEphemeralProfile(string leaf)
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

    public static string CreateEphemeralFlowProfile() => CreateEphemeralProfile("flow");

    public static string CreateEphemeralShellProfile() => CreateEphemeralProfile("shell");

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
