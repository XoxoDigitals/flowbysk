using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FlowBrowser;

public sealed class AppConfig
{
    public const string DefaultServerUrl = "https://flowcreatorai.site";

    [JsonPropertyName("serverUrl")]
    public string ServerUrl { get; set; } = DefaultServerUrl;

    [JsonPropertyName("authToken")]
    public string? AuthToken { get; set; }

    [JsonPropertyName("user")]
    public JsonElement? User { get; set; }

    [JsonPropertyName("activeServer")]
    public JsonElement? ActiveServer { get; set; }

    [JsonPropertyName("zoomLevel")]
    public double ZoomLevel { get; set; }

    static string SecureDir => DataPaths.SecureDir;
    static string SecureConfigPath => DataPaths.SecureSessionPath;
    static string LegacyConfigPath => DataPaths.LegacyPlainConfig;
    static string LegacySecurePath => DataPaths.LegacySecureSession;

    static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = false,
        PropertyNamingPolicy = null,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never
    };

    public static AppConfig Load()
    {
        try
        {
            DataPaths.MigrateFromLegacy();

            // Prefer DPAPI-encrypted blob (new opaque path)
            if (File.Exists(SecureConfigPath))
                return LoadFromProtected(SecureConfigPath);

            // Migrate previous Local\FlowBrowser\.secure\session.bin
            if (File.Exists(LegacySecurePath))
            {
                var cfg = LoadFromProtected(LegacySecurePath);
                cfg.Save();
                return cfg;
            }

            // Migrate legacy plaintext JSON → encrypted, then delete plaintext
            if (File.Exists(LegacyConfigPath))
            {
                var json = File.ReadAllText(LegacyConfigPath);
                var cfg = JsonSerializer.Deserialize<AppConfig>(json, JsonOpts) ?? new AppConfig();
                cfg.SanitizeSecrets();
                if (NeedsProductionUrl(cfg.ServerUrl))
                    cfg.ServerUrl = DefaultServerUrl;
                cfg.Save();
                try { File.Delete(LegacyConfigPath); } catch { /* ignore */ }
                return cfg;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Error reading config: " + ex.Message);
        }
        return new AppConfig();
    }

    static AppConfig LoadFromProtected(string path)
    {
        var protectedBytes = File.ReadAllBytes(path);
        var plain = ProtectedData.Unprotect(protectedBytes, optionalEntropy: null, scope: DataProtectionScope.CurrentUser);
        var json = Encoding.UTF8.GetString(plain);
        var cfg = JsonSerializer.Deserialize<AppConfig>(json, JsonOpts) ?? new AppConfig();
        cfg.SanitizeSecrets();
        if (NeedsProductionUrl(cfg.ServerUrl))
        {
            cfg.ServerUrl = DefaultServerUrl;
            cfg.Save();
        }
        return cfg;
    }

    static bool NeedsProductionUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return true;
        var u = url.Trim().TrimEnd('/');
        return u.Contains("localhost", StringComparison.OrdinalIgnoreCase)
            || u.Contains("127.0.0.1")
            || u.Equals("http://flowcreatorai.site", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Never persist Google password / totp on disk.</summary>
    public void SanitizeSecrets()
    {
        if (ActiveServer == null || ActiveServer.Value.ValueKind != JsonValueKind.Object)
            return;
        try
        {
            using var doc = JsonDocument.Parse(ActiveServer.Value.GetRawText());
            using var stream = new MemoryStream();
            using (var writer = new Utf8JsonWriter(stream))
            {
                writer.WriteStartObject();
                foreach (var prop in doc.RootElement.EnumerateObject())
                {
                    var name = prop.Name;
                    if (name.Equals("password", StringComparison.OrdinalIgnoreCase) ||
                        name.Equals("totpSecret", StringComparison.OrdinalIgnoreCase) ||
                        name.Equals("totp", StringComparison.OrdinalIgnoreCase) ||
                        name.Equals("secret", StringComparison.OrdinalIgnoreCase))
                        continue;
                    prop.WriteTo(writer);
                }
                writer.WriteEndObject();
            }
            using var cleaned = JsonDocument.Parse(stream.ToArray());
            ActiveServer = cleaned.RootElement.Clone();
        }
        catch
        {
            ActiveServer = null;
        }
    }

    public void Save()
    {
        try
        {
            SanitizeSecrets();
            DataPaths.EnsureTree();
            Directory.CreateDirectory(SecureDir);
            DataPaths.TryHide(SecureDir);

            var json = JsonSerializer.Serialize(this, JsonOpts);
            var plain = Encoding.UTF8.GetBytes(json);
            var protectedBytes = ProtectedData.Protect(plain, optionalEntropy: null, scope: DataProtectionScope.CurrentUser);
            File.WriteAllBytes(SecureConfigPath, protectedBytes);
            DataPaths.TryHide(SecureConfigPath);

            try
            {
                if (File.Exists(LegacyConfigPath))
                    File.Delete(LegacyConfigPath);
            }
            catch { /* ignore */ }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Error saving config: " + ex.Message);
        }
    }

    public string ToJson()
    {
        SanitizeSecrets();
        return JsonSerializer.Serialize(this, JsonOpts);
    }
}
