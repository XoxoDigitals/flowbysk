using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.WebSockets;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;

namespace FlowBrowser;

internal sealed class ZexTtsService
{
    private const string BaseUrl = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
    private const string TrustedClientToken = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
    private const string ChromiumFullVersion = "143.0.3650.75";
    private const string ChromiumMajorVersion = "143";
    private const string SecMsGecVersion = "2-" + ChromiumFullVersion;
    private const long WinEpoch = 11644473600L;

    private static readonly HttpClient Http = CreateHttpClient();
    private static double _clockSkewSeconds;
    private List<VoiceDto>? _cachedVoices;
    private readonly string _workRoot;
    private readonly string _previewsDir;
    private readonly string _defaultOutputDir;

    public ZexTtsService()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        _workRoot = Path.Combine(localAppData, "FlowBrowser", "zextts_work");
        _previewsDir = Path.Combine(_workRoot, "previews");
        var downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        _defaultOutputDir = Path.Combine(downloads, "ZexTTS_Output");
        try
        {
            Directory.CreateDirectory(_workRoot);
            Directory.CreateDirectory(_previewsDir);
            Directory.CreateDirectory(_defaultOutputDir);
        }
        catch { /* ignore */ }

        // Pre-warm neural voice catalog in background so TTS STUDIO opens in 0ms
        _ = Task.Run(async () =>
        {
            try { await ListVoicesAsync(false).ConfigureAwait(false); }
            catch { /* ignore */ }
        });
    }

    private static HttpClient CreateHttpClient()
    {
        var handler = new HttpClientHandler
        {
            AutomaticDecompression = System.Net.DecompressionMethods.All
        };
        var client = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(25)
        };
        client.DefaultRequestHeaders.TryAddWithoutValidation(
            "User-Agent",
            $"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{ChromiumMajorVersion}.0.0.0 Safari/537.36 Edg/{ChromiumMajorVersion}.0.0.0");
        client.DefaultRequestHeaders.TryAddWithoutValidation("Accept-Language", "en-US,en;q=0.9");
        return client;
    }

    public sealed class VoiceDto
    {
        public string shortName { get; set; } = "";
        public string name { get; set; } = "";
        public string locale { get; set; } = "";
        public string gender { get; set; } = "";
    }

    public async Task<object> HandleCommandAsync(
        string cmd,
        JsonElement payload,
        Window ownerWindow,
        Action<string, object> emitProgress)
    {
        switch (cmd)
        {
            case "check_access":
                return new { access = "tox" };

            case "get_default_output_folder":
                try { Directory.CreateDirectory(_defaultOutputDir); } catch { }
                return new { ok = true, path = _defaultOutputDir };

            case "check_internet":
            {
                var online = await CheckInternetAsync();
                return new { ok = true, online };
            }

            case "list_voices":
            {
                var force = payload.ValueKind == JsonValueKind.Object &&
                            payload.TryGetProperty("force", out var fEl) &&
                            fEl.ValueKind == JsonValueKind.True;
                var voices = await ListVoicesAsync(force);
                return new { ok = true, voices };
            }

            case "choose_output_folder":
                return await ChooseOutputFolderAsync(ownerWindow);

            case "preview_voice":
                return await PreviewVoiceAsync(payload);

            case "generate_audio":
                return await GenerateAudioAsync(payload, emitProgress);

            case "generate_podcast":
                return await GeneratePodcastAsync(payload, emitProgress);

            case "open_external_url":
                return new { ok = true };

            default:
                return new { ok = false, error = "Unknown ZexTTS command: " + cmd };
        }
    }

    private Task<bool> CheckInternetAsync()
    {
        try
        {
            return Task.FromResult(System.Net.NetworkInformation.NetworkInterface.GetIsNetworkAvailable());
        }
        catch
        {
            return Task.FromResult(true);
        }
    }

    private async Task<List<VoiceDto>> ListVoicesAsync(bool force)
    {
        if (!force && _cachedVoices is { Count: > 0 })
            return _cachedVoices;

        var cacheFile = Path.Combine(_workRoot, "voices_cache_v2.json");
        if (!force && File.Exists(cacheFile))
        {
            try
            {
                var cachedJson = await File.ReadAllTextAsync(cacheFile);
                var loaded = JsonSerializer.Deserialize<List<VoiceDto>>(cachedJson);
                if (loaded is { Count: > 0 })
                {
                    _cachedVoices = loaded;
                    return loaded;
                }
            }
            catch { /* fetch fresh */ }
        }

        // Also check existing ZexTTS cache or fetch from Microsoft
        using var req = new HttpRequestMessage(
            HttpMethod.Get,
            $"https://{BaseUrl}/voices/list?trustedclienttoken={TrustedClientToken}&Sec-MS-GEC={GenerateSecMsGecV2()}&Sec-MS-GEC-Version={SecMsGecVersion}");
        AddVoiceHeaders(req);
        using var resp = await Http.SendAsync(req);
        SyncClockSkewFromHeaders(resp);
        resp.EnsureSuccessStatusCode();
        var raw = await resp.Content.ReadAsStringAsync();

        using var doc = JsonDocument.Parse(raw);
        var list = new List<VoiceDto>();
        if (doc.RootElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                var shortName = item.TryGetProperty("ShortName", out var sn) ? sn.GetString() ?? "" : "";
                if (string.IsNullOrWhiteSpace(shortName)) continue;
                var friendly = item.TryGetProperty("FriendlyName", out var fn) ? fn.GetString() ?? "" : "";
                var name = item.TryGetProperty("Name", out var nm) ? nm.GetString() ?? "" : "";
                var locale = item.TryGetProperty("Locale", out var loc) ? loc.GetString() ?? "" : "";
                var gender = item.TryGetProperty("Gender", out var gen) ? gen.GetString() ?? "" : "";
                list.Add(new VoiceDto
                {
                    shortName = shortName,
                    name = !string.IsNullOrWhiteSpace(friendly) ? friendly : name,
                    locale = locale,
                    gender = gender
                });
            }
        }

        _cachedVoices = list;
        try
        {
            await File.WriteAllTextAsync(cacheFile, JsonSerializer.Serialize(list));
        }
        catch { /* ignore */ }
        return list;
    }

    private static void AddVoiceHeaders(HttpRequestMessage req)
    {
        req.Headers.TryAddWithoutValidation("Authority", "speech.platform.bing.com");
        req.Headers.TryAddWithoutValidation("Sec-CH-UA", $"\" Not;A Brand\";v=\"99\", \"Microsoft Edge\";v=\"{ChromiumMajorVersion}\", \"Chromium\";v=\"{ChromiumMajorVersion}\"");
        req.Headers.TryAddWithoutValidation("Sec-CH-UA-Mobile", "?0");
        req.Headers.TryAddWithoutValidation("Accept", "*/*");
        req.Headers.TryAddWithoutValidation("Sec-Fetch-Site", "none");
        req.Headers.TryAddWithoutValidation("Sec-Fetch-Mode", "cors");
        req.Headers.TryAddWithoutValidation("Sec-Fetch-Dest", "empty");
        req.Headers.TryAddWithoutValidation("Cookie", $"muid={GenerateMuid()};");
    }

    private static void SyncClockSkewFromHeaders(HttpResponseMessage resp)
    {
        try
        {
            if (resp.Headers.Date.HasValue)
            {
                var serverSec = resp.Headers.Date.Value.ToUnixTimeSeconds();
                var localSec = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                _clockSkewSeconds = serverSec - localSec;
            }
        }
        catch { /* ignore */ }
    }

    private Task<object> ChooseOutputFolderAsync(Window ownerWindow)
    {
        var tcs = new TaskCompletionSource<object>();
        ownerWindow.Dispatcher.InvokeAsync(() =>
        {
            try
            {
                var dlg = new Microsoft.Win32.OpenFolderDialog
                {
                    Title = "Select Output Folder for ZexTTS Audio",
                    InitialDirectory = Directory.Exists(_defaultOutputDir)
                        ? _defaultOutputDir
                        : Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)
                };
                var res = dlg.ShowDialog(ownerWindow);
                if (res == true && !string.IsNullOrWhiteSpace(dlg.FolderName))
                {
                    tcs.TrySetResult(new { ok = true, path = dlg.FolderName });
                }
                else
                {
                    tcs.TrySetResult(new { ok = false, cancelled = true });
                }
            }
            catch (Exception ex)
            {
                tcs.TrySetResult(new { ok = false, error = ex.Message });
            }
        });
        return tcs.Task;
    }

    private async Task<object> PreviewVoiceAsync(JsonElement payload)
    {
        var voice = payload.TryGetProperty("voice", out var vEl) ? vEl.GetString() ?? "" : "";
        if (string.IsNullOrWhiteSpace(voice))
            return new { ok = false, error = "No voice selected" };

        var rate = GetDouble(payload, "rate", 1.0);
        var pitch = GetDouble(payload, "pitch", 1.0);
        var volume = GetDouble(payload, "volume", 1.0);
        var force = payload.TryGetProperty("force", out var fEl) && fEl.ValueKind == JsonValueKind.True;

        var safeVoice = Regex.Replace(voice, @"[^a-zA-Z0-9_-]", "_");
        var isDefaultProsody = Math.Abs(rate - 1.0) < 0.001 && Math.Abs(pitch - 1.0) < 0.001 && Math.Abs(volume - 1.0) < 0.001;
        var previewFile = Path.Combine(_previewsDir, $"{safeVoice}_zextts_v1.mp3");

        // Also check existing ZexTTS preview cache if present
        var legacyPreview = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ZexTTS", "work", "previews", $"{safeVoice}_zextts_v1.mp3");

        if (!force && isDefaultProsody)
        {
            if (File.Exists(previewFile))
            {
                var cachedBytes = await File.ReadAllBytesAsync(previewFile);
                if (cachedBytes.Length > 256)
                {
                    return new
                    {
                        ok = true,
                        audioUrl = "data:audio/mpeg;base64," + Convert.ToBase64String(cachedBytes),
                        previewPath = previewFile,
                        source = "cache"
                    };
                }
            }
            if (File.Exists(legacyPreview))
            {
                var cachedBytes = await File.ReadAllBytesAsync(legacyPreview);
                if (cachedBytes.Length > 256)
                {
                    return new
                    {
                        ok = true,
                        audioUrl = "data:audio/mpeg;base64," + Convert.ToBase64String(cachedBytes),
                        previewPath = legacyPreview,
                        source = "cache"
                    };
                }
            }
        }

        const string sampleText = "Hello! This is a preview of how I sound in TTS Studio.";
        var mp3 = await SynthesizeChunkAsync(sampleText, voice, rate, pitch, volume);
        if (isDefaultProsody)
        {
            try { await File.WriteAllBytesAsync(previewFile, mp3); } catch { }
        }
        return new
        {
            ok = true,
            audioUrl = "data:audio/mpeg;base64," + Convert.ToBase64String(mp3),
            previewPath = previewFile,
            source = "generated"
        };
    }

    private async Task<object> GenerateAudioAsync(JsonElement payload, Action<string, object> emitProgress)
    {
        var text = payload.TryGetProperty("text", out var tEl) ? tEl.GetString() ?? "" : "";
        var voice = payload.TryGetProperty("voice", out var vEl) ? vEl.GetString() ?? "" : "";
        var outputDir = payload.TryGetProperty("outputDir", out var oEl) ? oEl.GetString() ?? "" : "";
        var rate = GetDouble(payload, "rate", 1.0);
        var pitch = GetDouble(payload, "pitch", 1.0);
        var volume = GetDouble(payload, "volume", 1.0);

        if (string.IsNullOrWhiteSpace(text))
            return new { ok = false, error = "Enter text first" };
        if (string.IsNullOrWhiteSpace(voice))
            return new { ok = false, error = "Select a voice" };

        if (string.IsNullOrWhiteSpace(outputDir))
            outputDir = _defaultOutputDir;
        try { Directory.CreateDirectory(outputDir); }
        catch (Exception ex) { return new { ok = false, error = "Invalid output folder: " + ex.Message }; }

        var sw = Stopwatch.StartNew();
        var chunks = SplitTextIntoChunks(text.Trim(), 2400);
        emitProgress("generation-progress", new { phase = "start", progress = 0.01, currentChunk = 0, totalChunks = chunks.Count });

        var chunkResults = new byte[chunks.Count][];
        int completedCount = 0;
        using var sem = new SemaphoreSlim(4);
        var tasks = Enumerable.Range(0, chunks.Count).Select(async idx =>
        {
            await sem.WaitAsync().ConfigureAwait(false);
            try
            {
                var bytes = await SynthesizeChunkAsync(chunks[idx], voice, rate, pitch, volume).ConfigureAwait(false);
                chunkResults[idx] = bytes;
                var doneNow = Interlocked.Increment(ref completedCount);
                emitProgress("generation-progress", new
                {
                    phase = "chunk",
                    currentChunk = doneNow,
                    totalChunks = chunks.Count,
                    progress = (double)doneNow / chunks.Count
                });
            }
            finally
            {
                sem.Release();
            }
        });
        await Task.WhenAll(tasks).ConfigureAwait(false);

        using var combined = new MemoryStream();
        for (int i = 0; i < chunkResults.Length; i++)
        {
            combined.Write(chunkResults[i], 0, chunkResults[i].Length);
        }

        var finalBytes = combined.ToArray();
        var safeVoice = Regex.Replace(voice, @"[^a-zA-Z0-9_-]", "_");
        var stamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
        var outFile = Path.Combine(outputDir, $"tts_studio_{safeVoice}_{stamp}.mp3");
        await File.WriteAllBytesAsync(outFile, finalBytes);
        sw.Stop();

        emitProgress("generation-progress", new { phase = "done", progress = 1.0, currentChunk = chunks.Count, totalChunks = chunks.Count });

        return new
        {
            ok = true,
            audioUrl = "data:audio/mpeg;base64," + Convert.ToBase64String(finalBytes),
            outputPath = outFile,
            totalChunks = chunks.Count,
            elapsedMs = sw.ElapsedMilliseconds
        };
    }

    private async Task<object> GeneratePodcastAsync(JsonElement payload, Action<string, object> emitProgress)
    {
        var outputDir = payload.TryGetProperty("outputDir", out var oEl) ? oEl.GetString() ?? "" : "";
        var rate = GetDouble(payload, "rate", 1.0);
        var pitch = GetDouble(payload, "pitch", 1.0);
        var volume = GetDouble(payload, "volume", 1.0);

        if (string.IsNullOrWhiteSpace(outputDir))
            outputDir = _defaultOutputDir;
        try { Directory.CreateDirectory(outputDir); }
        catch (Exception ex) { return new { ok = false, error = "Invalid output folder: " + ex.Message }; }

        var charVoices = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (payload.TryGetProperty("characters", out var charsEl) && charsEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var c in charsEl.EnumerateArray())
            {
                var name = c.TryGetProperty("name", out var nEl) ? (nEl.GetString() ?? "").Trim() : "";
                var voiceId = c.TryGetProperty("voiceId", out var vEl) ? (vEl.GetString() ?? "").Trim() : "";
                if (!string.IsNullOrEmpty(name) && !string.IsNullOrEmpty(voiceId))
                    charVoices[name] = voiceId;
            }
        }

        var lines = new List<(string Speaker, string Text)>();
        if (payload.TryGetProperty("dialogue", out var diagEl) && diagEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var l in diagEl.EnumerateArray())
            {
                var spk = l.TryGetProperty("character", out var sEl) ? (sEl.GetString() ?? "").Trim() : "";
                var txt = l.TryGetProperty("text", out var tEl) ? (tEl.GetString() ?? "").Trim() : "";
                if (!string.IsNullOrEmpty(txt))
                    lines.Add((spk, txt));
            }
        }

        if (lines.Count == 0)
            return new { ok = false, error = "Add dialogue lines first" };

        var sw = Stopwatch.StartNew();
        var jobId = Guid.NewGuid().ToString("N")[..8];
        emitProgress("podcast-progress", new { phase = "start", progress = 0.01, current = 0, total = lines.Count });

        var lineResults = new byte[lines.Count][];
        int completedCount = 0;
        using var sem = new SemaphoreSlim(4);
        var tasks = Enumerable.Range(0, lines.Count).Select(async idx =>
        {
            await sem.WaitAsync().ConfigureAwait(false);
            try
            {
                var (speaker, lineText) = lines[idx];
                if (!charVoices.TryGetValue(speaker, out var voiceId) || string.IsNullOrWhiteSpace(voiceId))
                {
                    voiceId = charVoices.Values.FirstOrDefault() ?? "en-US-AriaNeural";
                }
                var bytes = await SynthesizeChunkAsync(lineText, voiceId, rate, pitch, volume).ConfigureAwait(false);
                lineResults[idx] = bytes;
                var doneNow = Interlocked.Increment(ref completedCount);
                emitProgress("podcast-progress", new
                {
                    phase = "line",
                    speaker,
                    current = doneNow,
                    total = lines.Count,
                    progress = (double)doneNow / lines.Count
                });
            }
            finally
            {
                sem.Release();
            }
        });
        await Task.WhenAll(tasks).ConfigureAwait(false);

        using var combined = new MemoryStream();
        for (int i = 0; i < lineResults.Length; i++)
        {
            combined.Write(lineResults[i], 0, lineResults[i].Length);
        }

        var finalBytes = combined.ToArray();
        var stamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
        var outFile = Path.Combine(outputDir, $"podcast_{jobId}_{stamp}.mp3");
        await File.WriteAllBytesAsync(outFile, finalBytes);
        sw.Stop();

        emitProgress("podcast-progress", new { phase = "done", progress = 1.0, current = lines.Count, total = lines.Count });

        return new
        {
            ok = true,
            jobId,
            audioUrl = "data:audio/mpeg;base64," + Convert.ToBase64String(finalBytes),
            outputPath = outFile,
            elapsedMs = sw.ElapsedMilliseconds
        };
    }

    private static List<string> SplitTextIntoChunks(string text, int maxChars)
    {
        var result = new List<string>();
        if (string.IsNullOrWhiteSpace(text)) return result;
        if (text.Length <= maxChars)
        {
            result.Add(text);
            return result;
        }

        var sentences = Regex.Split(text, @"(?<=[.!?;\r\n])\s+");
        var current = new StringBuilder();
        foreach (var s in sentences)
        {
            if (string.IsNullOrWhiteSpace(s)) continue;
            if (current.Length + s.Length + 1 > maxChars && current.Length > 0)
            {
                result.Add(current.ToString().Trim());
                current.Clear();
            }
            if (s.Length > maxChars)
            {
                for (int i = 0; i < s.Length; i += maxChars)
                {
                    result.Add(s.Substring(i, Math.Min(maxChars, s.Length - i)));
                }
            }
            else
            {
                if (current.Length > 0) current.Append(' ');
                current.Append(s);
            }
        }
        if (current.Length > 0)
            result.Add(current.ToString().Trim());
        return result;
    }

    private static string FormatFullVoiceName(string voice)
    {
        var m = Regex.Match(voice.Trim(), @"^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$");
        if (m.Success)
        {
            var lang = m.Groups[1].Value;
            var region = m.Groups[2].Value;
            var name = m.Groups[3].Value;
            var dashIdx = name.IndexOf('-');
            if (dashIdx >= 0)
            {
                region = region + "-" + name[..dashIdx];
                name = name[(dashIdx + 1)..];
            }
            return $"Microsoft Server Speech Text to Speech Voice ({lang}-{region}, {name})";
        }
        return voice;
    }

    private async Task<byte[]> SynthesizeChunkAsync(string text, string voice, double rate, double pitch, double volume)
    {
        var ratePct = (int)Math.Round((rate - 1.0) * 100.0);
        var pitchHz = (int)Math.Round((pitch - 1.0) * 50.0);
        var volPct = (int)Math.Round((volume - 1.0) * 100.0);

        var rateStr = $"{(ratePct >= 0 ? "+" : "")}{ratePct}%";
        var pitchStr = $"{(pitchHz >= 0 ? "+" : "")}{pitchHz}Hz";
        var volStr = $"{(volPct >= 0 ? "+" : "")}{volPct}%";

        var fullVoice = FormatFullVoiceName(voice);
        var escapedText = SecurityElement.Escape(SanitizeXmlChars(text)) ?? "";

        var ssml =
            $"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
            $"<voice name='{fullVoice}'>" +
            $"<prosody pitch='{pitchStr}' rate='{rateStr}' volume='{volStr}'>" +
            $"{escapedText}" +
            $"</prosody></voice></speak>";

        var connectId = Guid.NewGuid().ToString("N");
        var secMsGec = GenerateSecMsGecV2();
        var wssUri = new Uri(
            $"wss://{BaseUrl}/edge/v1?TrustedClientToken={TrustedClientToken}&ConnectionId={connectId}&Sec-MS-GEC={secMsGec}&Sec-MS-GEC-Version={SecMsGecVersion}");

        using var ws = new ClientWebSocket();
        ws.Options.SetRequestHeader("Pragma", "no-cache");
        ws.Options.SetRequestHeader("Cache-Control", "no-cache");
        ws.Options.SetRequestHeader("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold");
        ws.Options.SetRequestHeader(
            "User-Agent",
            $"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{ChromiumMajorVersion}.0.0.0 Safari/537.36 Edg/{ChromiumMajorVersion}.0.0.0");
        ws.Options.SetRequestHeader("Accept-Language", "en-US,en;q=0.9");
        ws.Options.SetRequestHeader("Cookie", $"muid={GenerateMuid()};");

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(45));
        await ws.ConnectAsync(wssUri, cts.Token);

        var ts = DateTime.UtcNow.ToString("ddd MMM dd yyyy HH:mm:ss 'GMT+0000 (Coordinated Universal Time)'", System.Globalization.CultureInfo.InvariantCulture);
        var configMsg =
            $"X-Timestamp:{ts}\r\n" +
            "Content-Type:application/json; charset=utf-8\r\n" +
            "Path:speech.config\r\n\r\n" +
            "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{\"sentenceBoundaryEnabled\":\"true\",\"wordBoundaryEnabled\":\"false\"},\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}\r\n";

        await SendTextAsync(ws, configMsg, cts.Token);

        var requestId = Guid.NewGuid().ToString("N");
        var ssmlMsg =
            $"X-RequestId:{requestId}\r\n" +
            "Content-Type:application/ssml+xml\r\n" +
            $"X-Timestamp:{ts}Z\r\n" +
            "Path:ssml\r\n\r\n" +
            ssml;

        await SendTextAsync(ws, ssmlMsg, cts.Token);

        using var audioOut = new MemoryStream();
        using var frameBuf = new MemoryStream();
        var recvBuf = new byte[16384];

        while (ws.State == WebSocketState.Open)
        {
            frameBuf.SetLength(0);
            WebSocketReceiveResult result;
            do
            {
                result = await ws.ReceiveAsync(new ArraySegment<byte>(recvBuf), cts.Token);
                if (result.MessageType == WebSocketMessageType.Close)
                    break;
                frameBuf.Write(recvBuf, 0, result.Count);
            } while (!result.EndOfMessage);

            if (result.MessageType == WebSocketMessageType.Close)
                break;

            var msgBytes = frameBuf.ToArray();
            if (result.MessageType == WebSocketMessageType.Text)
            {
                var txt = Encoding.UTF8.GetString(msgBytes);
                if (txt.Contains("Path:turn.end", StringComparison.Ordinal))
                    break;
            }
            else if (result.MessageType == WebSocketMessageType.Binary)
            {
                if (msgBytes.Length < 2) continue;
                int headerLen = (msgBytes[0] << 8) | msgBytes[1];
                if (2 + headerLen > msgBytes.Length) continue;
                var headerText = Encoding.UTF8.GetString(msgBytes, 2, headerLen);
                if (headerText.Contains("Path:audio", StringComparison.Ordinal))
                {
                    int audioOffset = 2 + headerLen;
                    int audioCount = msgBytes.Length - audioOffset;
                    if (audioCount > 0)
                        audioOut.Write(msgBytes, audioOffset, audioCount);
                }
            }
        }

        var output = audioOut.ToArray();
        if (output.Length == 0)
            throw new InvalidOperationException("No audio received from speech service.");
        return output;
    }

    private static Task SendTextAsync(ClientWebSocket ws, string text, CancellationToken ct)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        return ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
    }

    private static string SanitizeXmlChars(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s)
        {
            int code = ch;
            if (code == 9 || code == 10 || code == 13 || code >= 32)
                sb.Append(ch);
            else
                sb.Append(' ');
        }
        return sb.ToString();
    }

    private static double GetDouble(JsonElement el, string prop, double fallback)
    {
        if (el.ValueKind == JsonValueKind.Object && el.TryGetProperty(prop, out var v))
        {
            if (v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d))
                return d;
            if (v.ValueKind == JsonValueKind.String && double.TryParse(v.GetString(), out var ds))
                return ds;
        }
        return fallback;
    }

    private static string GenerateMuid()
    {
        Span<byte> buf = stackalloc byte[16];
        RandomNumberGenerator.Fill(buf);
        return Convert.ToHexString(buf);
    }

    // =====================================================================
    // Sec-MS-GEC v2 Token Generator (Port of edge-tts 7.3.1 drm.py)
    // =====================================================================
    private static readonly uint[] Sha256Initial =
    {
        0x6A09E667u, 0xBB67AE85u, 0x3C6EF372u, 0xA54FF53Au,
        0x510E527Fu, 0x9B05688Cu, 0x1F83D9ABu, 0x5BE0CD19u
    };

    private static readonly uint[] Sha256State =
    {
        0xFD9FBEA2u, 0x91243CE7u, 0xBE499094u, 0xCD2E1E0Au,
        0x6C006F49u, 0x04BD35ABu, 0xFEB0A7E4u, 0x03EFFBD2u
    };

    private static readonly uint[] Sha256Schedule =
    {
        0xEB24BF9Eu, 0x1558691Fu, 0xA0C09EE2u, 0x0CFA32BAu,
        0xA622EE8Cu, 0xD1DD9491u, 0xC0DD25A0u, 0xF9E70AB6u,
        0xF0C31573u, 0x7058CE4Eu, 0x7188E606u, 0x00E5AB33u,
        0xD258B060u, 0x72766564u
    };

    private static readonly uint[] Sha256RoundConstants =
    {
        0x428A2F98u, 0x71374491u, 0xB5C0FBCFu, 0xE9B5DBA5u, 0x3956C25Bu, 0x59F111F1u, 0x923F82A4u, 0xAB1C5ED5u,
        0xD807AA98u, 0x12835B01u, 0x243185BEu, 0x550C7DC3u, 0x72BE5D74u, 0x80DEB1FEu, 0x9BDC06A7u, 0xC19BF174u,
        0xE49B69C1u, 0xEFBE4786u, 0x0FC19DC6u, 0x240CA1CCu, 0x2DE92C6Fu, 0x4A7484AAu, 0x5CB0A9DCu, 0x76F988DAu,
        0x983E5152u, 0xA831C66Du, 0xB00327C8u, 0xBF597FC7u, 0xC6E00BF3u, 0xD5A79147u, 0x06CA6351u, 0x14292967u,
        0x27B70A85u, 0x2E1B2138u, 0x4D2C6DFCu, 0x53380D13u, 0x650A7354u, 0x766A0ABBu, 0x81C2C92Eu, 0x92722C85u,
        0xA2BFE8A1u, 0xA81A664Bu, 0xC24B8B70u, 0xC76C51A3u, 0xD192E819u, 0xD6990624u, 0xF40E3585u, 0x106AA070u,
        0x19A4C116u, 0x1E376C08u, 0x2748774Cu, 0x34B0BCB5u, 0x391C0CB3u, 0x4ED8AA4Au, 0x5B9CCA4Fu, 0x682E6FF3u,
        0x748F82EEu, 0x78A5636Fu, 0x84C87814u, 0x8CC70208u, 0x90BEFFFAu, 0xA4506CEBu, 0xBEF9A3F7u, 0xC67178F2u
    };

    private const uint Sha256Adjustment = 0xC9DC06A7u;
    private const uint Sha256Sigma0Adjustment = 0x059C0B80u;
    private const uint Sha256Sigma1Adjustment = 0x000B92C0u;

    private static readonly (uint Coeff, uint Offset)[] Cs64Coefficients =
    {
        (0xE82E91B1u, 0xB32700D0u),
        (0x44DE24C6u, 0x88DFF51Du),
        (0x3BEB65BCu, 0x29514038u),
        (0xC89C5933u, 0xB328CBDFu),
        (0x8D1EC211u, 0xD405B4D5u),
        (0x314EF5D5u, 0x26E55F3Cu),
        (0xE92491B1u, 0x607801C6u),
        (0xF0A5B9D5u, 0x82B2C1FBu),
        (0x06064CF3u, 0xFA51A3DAu),
        (0xDA79FA60u, 0x207CC464u),
        (0xBED20560u, 0x3C3C74F3u),
        (0x89F9C9F8u, 0xD2D14B61u),
        (0x35FA38C6u, 0xBB04A2C1u),
        (0xCB49E3C6u, 0xC5626167u)
    };

    private const uint Cs64Factor = 0x82893933u;
    private const uint Cs64Adjustment0 = 0xF2F90B1Au;
    private const uint Cs64Adjustment1 = 0x0B1A0000u;

    private static uint Rol16(uint value) => (value << 16) | (value >> 16);

    private static uint Sigma0(uint v) => (v >> 7) ^ (v << 25) ^ (v >> 18) ^ (v << 14) ^ (v >> 3);

    private static uint Sigma1(uint v) => (v >> 17) ^ (v << 15) ^ (v >> 19) ^ (v << 13) ^ (v >> 10);

    public static string GenerateSecMsGecV2()
    {
        unchecked
        {
            double unixTs = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + _clockSkewSeconds;
            long ticks = (long)Math.Floor(unixTs) + WinEpoch;
            ticks -= ticks % 300;
            long fileTimeTicks = ticks * 10_000_000L;
            var strToHash = $"{fileTimeTicks}{TrustedClientToken}";
            var data = Encoding.ASCII.GetBytes(strToHash);

            var digest = Sha256Digest(data);
            var (cs0, cs1) = Cs64Digest(data, digest);
            Span<byte> csBytes = stackalloc byte[8];
            BinaryPrimitives.WriteUInt32LittleEndian(csBytes[..4], cs0);
            BinaryPrimitives.WriteUInt32LittleEndian(csBytes[4..8], cs1);

            return $"{Convert.ToHexString(csBytes)}-{Convert.ToHexString(digest)}";
        }
    }

    private static uint[] Sha256Rounds(uint[] state, uint[] words, int firstRound = 0)
    {
        unchecked
        {
            uint a = state[0], b = state[1], c = state[2], d = state[3];
            uint e = state[4], f = state[5], g = state[6], h = state[7];

            for (int index = firstRound; index < 64; index++)
            {
                uint k = (firstRound == 14 && index == 14) ? Sha256Adjustment : Sha256RoundConstants[index];
                ulong rotE = (ulong)e * 0x100000001UL;
                ulong rotA = (ulong)a * 0x100000001UL;
                uint s1 = (uint)((rotE >> 6) ^ (rotE >> 11) ^ (rotE >> 25));
                uint ch = g ^ (e & (f ^ g));
                uint t1 = h + s1 + ch + k + words[index];
                uint s0 = (uint)((rotA >> 2) ^ (rotA >> 13) ^ (rotA >> 22));
                uint maj = (a & b) | (c & (a | b));
                uint t2 = s0 + maj;

                h = g;
                g = f;
                f = e;
                e = d + t1;
                d = c;
                c = b;
                b = a;
                a = t1 + t2;
            }

            return new[] { a, b, c, d, e, f, g, h };
        }
    }

    private static void ExpandSha256Schedule(uint[] words, int firstWord = 16)
    {
        unchecked
        {
            for (int i = firstWord; i < 64; i++)
            {
                uint x = words[i - 2];
                uint y = words[i - 15];
                uint s1 = Sigma1(x);
                uint s0 = Sigma0(y);
                words[i] = s1 + words[i - 7] + s0 + words[i - 16];
            }
        }
    }

    private static uint[] Sha256Init(ReadOnlySpan<byte> first7)
    {
        unchecked
        {
            var words = new uint[64];
            words[14] = (uint)((first7[0] << 16) | (first7[1] << 8) | first7[2]);
            words[15] = BinaryPrimitives.ReadUInt32BigEndian(first7.Slice(3, 4));

            for (int index = 16; index < 30; index++)
            {
                uint value = Sha256Schedule[index - 16];
                if (index - 2 >= 14)
                {
                    value += index == 16
                        ? (Sigma1(words[index - 2]) ^ Sha256Sigma1Adjustment)
                        : Sigma1(words[index - 2]);
                }
                if (index - 7 >= 14)
                {
                    value += words[index - 7];
                }
                if (index - 15 >= 14)
                {
                    value += index == 29
                        ? (Sigma0(words[index - 15]) ^ Sha256Sigma0Adjustment)
                        : Sigma0(words[index - 15]);
                }
                words[index] = value;
            }

            words[30] = Sigma1(words[28]) + words[23] + Sigma0(words[15]) + words[14] + Sha256Adjustment - Sha256RoundConstants[14];
            ExpandSha256Schedule(words, 31);
            var working = Sha256Rounds(Sha256State, words, 14);
            var res = new uint[8];
            for (int i = 0; i < 8; i++)
                res[i] = Sha256Initial[i] + working[i];
            return res;
        }
    }

    private static byte[] Sha256Digest(byte[] data)
    {
        unchecked
        {
            int length = 57 + data.Length;
            int tailLen = data.Length - 7;
            int zeroPad = ((55 - length) % 64 + 64) % 64;
            var padded = new byte[tailLen + 1 + zeroPad + 8];
            Array.Copy(data, 7, padded, 0, tailLen);
            padded[tailLen] = 0x80;
            BinaryPrimitives.WriteUInt64BigEndian(padded.AsSpan(padded.Length - 8, 8), (ulong)length * 8UL);

            var state = Sha256Init(data.AsSpan(0, 7));
            var words = new uint[64];
            for (int offset = 0; offset < padded.Length; offset += 64)
            {
                for (int i = 0; i < 16; i++)
                    words[i] = BinaryPrimitives.ReadUInt32BigEndian(padded.AsSpan(offset + i * 4, 4));
                ExpandSha256Schedule(words, 16);
                var working = Sha256Rounds(state, words, 0);
                for (int i = 0; i < 8; i++)
                    state[i] += working[i];
            }

            var outBytes = new byte[32];
            for (int i = 0; i < 8; i++)
                BinaryPrimitives.WriteUInt32BigEndian(outBytes.AsSpan(i * 4, 4), state[i]);
            return outBytes;
        }
    }

    private static List<uint> WordsLe4Even(byte[] dataWithZeroPrefix)
    {
        int rem = dataWithZeroPrefix.Length % 4;
        int pad = rem == 0 ? 0 : (4 - rem);
        var padded = new byte[dataWithZeroPrefix.Length + pad];
        Array.Copy(dataWithZeroPrefix, padded, dataWithZeroPrefix.Length);
        var words = new List<uint>(padded.Length / 4 + 1);
        for (int i = 0; i < padded.Length; i += 4)
            words.Add(BinaryPrimitives.ReadUInt32LittleEndian(padded.AsSpan(i, 4)));
        if (words.Count % 2 != 0)
            words.Add(0u);
        return words;
    }

    private static (uint, uint) Cs64Digest(byte[] data, byte[] digest)
    {
        unchecked
        {
            uint keyA = BinaryPrimitives.ReadUInt32LittleEndian(digest.AsSpan(0, 4)) | 1u;
            uint keyB = BinaryPrimitives.ReadUInt32LittleEndian(digest.AsSpan(4, 4)) | 1u;
            uint factor0 = keyA * Cs64Factor;
            uint factor1 = keyB * Cs64Factor;

            var terms = new List<uint>();
            var offsets = new List<uint>();
            for (int i = 0; i < Cs64Coefficients.Length; i++)
            {
                terms.Add(Cs64Coefficients[i].Coeff * (i % 2 == 0 ? factor0 : factor1));
                offsets.Add(Cs64Coefficients[i].Offset);
            }

            var prefixed = new byte[1 + data.Length];
            Array.Copy(data, 0, prefixed, 1, data.Length);
            var dataWords = WordsLe4Even(prefixed);
            for (int index = 0; index < dataWords.Count; index++)
            {
                uint word = dataWords[index];
                uint term = word * (index % 2 == 0 ? keyA : keyB);
                uint offset = Rol16(word) * (index % 2 == 0 ? 0xEF0569FBu : 0xC31713DBu);
                if (index == 0)
                {
                    term += Cs64Adjustment0 * factor0;
                    offset += Cs64Adjustment1;
                }
                terms.Add(term);
                offsets.Add(offset);
            }

            uint swapAcc = 0u, swapLast = 0u, state = 0u, acc = 0u;
            for (int index = 0; index < terms.Count; index += 2)
            {
                uint x = terms[index];
                uint y = terms[index + 1];
                uint t = Rol16(offsets[index] + x);
                uint q = t * 0x76F50F34u;
                swapAcc += Rol16(q) * 0xC3EFEA97u + q;

                t = Rol16(offsets[index + 1] + y);
                q = t * 0x1881CE3Cu;
                swapLast = Rol16(q) * 0x35BD1EC9u + q;
                swapAcc += swapLast;

                state = state * keyA + x;
                state = Rol16(state) * 0xCF98B111u;
                state = Rol16(state) * 0x87085B9Fu;
                state = Rol16(state) * 0x12CEB96Du;
                state = Rol16(state) * 0x257E1D83u;
                acc += state;

                t = state * keyB + y;
                t = Rol16(t) * 0xA27416F5u;
                t = Rol16(t) * 0xD38396FFu;
                state = Rol16(Rol16(t) * 0x7C932B89u) * 0xBFA49F69u;
                acc += state;
            }

            return (swapLast ^ state, swapAcc ^ acc);
        }
    }
}

