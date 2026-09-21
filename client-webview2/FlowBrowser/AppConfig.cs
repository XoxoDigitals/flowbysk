using System.IO;
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

    static string ConfigPath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "FlowBrowser",
            "flow_client_config.json");

    static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = null,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never
    };

    public static AppConfig Load()
    {
        try
        {
            var path = ConfigPath;
            if (File.Exists(path))
            {
                var json = File.ReadAllText(path);
                var cfg = JsonSerializer.Deserialize<AppConfig>(json, JsonOpts) ?? new AppConfig();
                if (NeedsProductionUrl(cfg.ServerUrl))
                {
                    cfg.ServerUrl = DefaultServerUrl;
                    cfg.Save();
                }
                return cfg;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Error reading config: " + ex.Message);
        }
        return new AppConfig();
    }

    static bool NeedsProductionUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return true;
        var u = url.Trim().TrimEnd('/');
        return u.Contains("localhost", StringComparison.OrdinalIgnoreCase)
            || u.Contains("127.0.0.1")
            || u.Equals("http://flowcreatorai.site", StringComparison.OrdinalIgnoreCase);
    }

    public void Save()
    {
        try
        {
            var dir = Path.GetDirectoryName(ConfigPath)!;
            Directory.CreateDirectory(dir);
            File.WriteAllText(ConfigPath, JsonSerializer.Serialize(this, JsonOpts));
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Error saving config: " + ex.Message);
        }
    }

    public string ToJson() => JsonSerializer.Serialize(this, JsonOpts);
}
