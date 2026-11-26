// Flow v15 device identity for the Windows EXE.
//  - Generates per-device Ed25519 (sign) + X25519 (envelope) keys on first run.
//  - Private keys are stored DPAPI-encrypted at rest (CurrentUser) and NEVER transmitted.
//  - Only PUBLIC keys are sent, ECIES-sealed to the server's static key, during registration.
//  - Produces signed+enveloped request material and opens enveloped responses.
// The crypto itself (CryptoV15.cs) is verified byte-for-byte against the Node server.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace FlowBrowser.Security
{
    public static class DeviceIdentityV15
    {
        // Server static X25519 PUBLIC key (private key provisioned to the server via env).
        const string SERVER_STATIC_PUB_B64URL = "auqCa5JiKBBI1OEWxIL39QteBxtzMF8-3bypJmvZg0I";
        const string APP_VERSION = "9.0.0";
        const string CLIENT = "windows-exe/" + APP_VERSION;

        static readonly byte[] ServerStaticPub = B64.UrlDecode(SERVER_STATIC_PUB_B64URL);
        static readonly object Gate = new();
        static long _serverOffsetMs = 0;

        sealed class Record
        {
            public string deviceId { get; set; } = "";
            public string envPrivHex { get; set; } = "";
            public string signSeedHex { get; set; } = "";
            public bool registered { get; set; } = false;
        }

        static string StorePath()
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FlowBrowser");
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, "dev15.bin");
        }

        static Record? LoadRaw()
        {
            try
            {
                var p = StorePath();
                if (!File.Exists(p)) return null;
                var prot = File.ReadAllBytes(p);
                var json = ProtectedData.Unprotect(prot, null, DataProtectionScope.CurrentUser);
                return JsonSerializer.Deserialize<Record>(Encoding.UTF8.GetString(json));
            }
            catch { return null; }
        }

        static void SaveRaw(Record r)
        {
            var json = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(r));
            var prot = ProtectedData.Protect(json, null, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(StorePath(), prot);
        }

        static Record EnsureRecord()
        {
            lock (Gate)
            {
                var r = LoadRaw();
                if (r != null && !string.IsNullOrEmpty(r.envPrivHex) && !string.IsNullOrEmpty(r.signSeedHex) && !string.IsNullOrEmpty(r.deviceId))
                    return r;
                var (envPriv, _) = DeviceKeysV15.GenerateX25519();
                var (signSeed, _) = DeviceKeysV15.GenerateEd25519();
                r = new Record
                {
                    deviceId = "win-" + Guid.NewGuid().ToString("N") + Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant(),
                    envPrivHex = Convert.ToHexString(envPriv).ToLowerInvariant(),
                    signSeedHex = Convert.ToHexString(signSeed).ToLowerInvariant(),
                    registered = false,
                };
                CryptographicOperations.ZeroMemory(envPriv);
                CryptographicOperations.ZeroMemory(signSeed);
                SaveRaw(r);
                return r;
            }
        }

        static byte[] Hex(string h)
        {
            var b = new byte[h.Length / 2];
            for (int i = 0; i < b.Length; i++) b[i] = Convert.ToByte(h.Substring(i * 2, 2), 16);
            return b;
        }

        public static void SetServerTime(long serverMs)
        {
            if (serverMs > 0) _serverOffsetMs = serverMs - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }
        static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + _serverOffsetMs;

        /// { registered, deviceId }
        public static string Status()
        {
            var r = EnsureRecord();
            return JsonSerializer.Serialize(new { registered = r.registered, deviceId = r.deviceId });
        }

        /// Build the registration payload: { eph, env } (ECIES-sealed public keys to the server static key).
        public static string PrepareRegister(string username, string password)
        {
            var r = EnsureRecord();
            var envPriv = Hex(r.envPrivHex);
            var signSeed = Hex(r.signSeedHex);
            var envPub = DeviceKeysV15.X25519PubFromPriv(envPriv);
            var signPub = DeviceKeysV15.Ed25519PubFromSeed(signSeed);

            var payload = new
            {
                username = username ?? "",
                password = password ?? "",
                deviceId = r.deviceId,
                envPub = B64.Url(envPub),
                signPub = B64.Url(signPub),
            };

            // ECIES: ephemeral X25519 -> shared with server static pub -> envelope key
            var (ephPriv, ephPub) = DeviceKeysV15.GenerateX25519();
            var eciesKey = DeviceKeysV15.DeriveEnvelopeKey(ephPriv, ServerStaticPub);
            var env = BodyEnvelope.Seal(payload, eciesKey);
            CryptographicOperations.ZeroMemory(ephPriv);
            CryptographicOperations.ZeroMemory(envPriv);
            CryptographicOperations.ZeroMemory(signSeed);

            return JsonSerializer.Serialize(new { eph = B64.Url(ephPub), env });
        }

        public static void MarkRegistered()
        {
            lock (Gate)
            {
                var r = EnsureRecord();
                r.registered = true;
                SaveRaw(r);
            }
        }

        /// Prepare a signed + enveloped request. Returns { headers, body } (body null for empty).
        public static string Prepare(string path, string method, string? bodyJson)
        {
            var r = EnsureRecord();
            var envPriv = Hex(r.envPrivHex);
            var signSeed = Hex(r.signSeedHex);
            try
            {
                var envKey = DeviceKeysV15.DeriveEnvelopeKey(envPriv, ServerStaticPub);
                Envelope? env = null;
                string wireHash = "";
                if (!string.IsNullOrEmpty(bodyJson) && bodyJson != "null" && bodyJson.Trim().Length > 0)
                {
                    env = BodyEnvelope.SealJson(bodyJson, envKey);
                    wireHash = DeviceKeysV15.Sha256B64url(env.c);
                }
                long ts = NowMs();
                string fullPath = path ?? "";
                string m = (method ?? "POST").ToUpperInvariant();
                string message = $"v15|{r.deviceId}|{m}|{fullPath}|{ts}|{wireHash}";
                string sig = DeviceKeysV15.Sign(signSeed, message);

                var headers = new Dictionary<string, string>
                {
                    ["x-flow-client"] = CLIENT,
                    ["x-flow-device-id"] = r.deviceId,
                    ["x-flow-ts"] = ts.ToString(),
                    ["x-flow-signature"] = sig,
                };
                return JsonSerializer.Serialize(new { headers, body = env });
            }
            finally
            {
                CryptographicOperations.ZeroMemory(envPriv);
                CryptographicOperations.ZeroMemory(signSeed);
            }
        }

        /// Open an enveloped response body; returns plaintext JSON (or the input unchanged if not enveloped).
        public static string Open(string? responseText)
        {
            if (string.IsNullOrWhiteSpace(responseText)) return responseText ?? "";
            try
            {
                using var doc = JsonDocument.Parse(responseText);
                var root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("c", out _) || !root.TryGetProperty("n", out _))
                    return responseText; // plaintext error / non-enveloped
                var env = new Envelope
                {
                    v = root.TryGetProperty("v", out var vEl) && vEl.ValueKind == JsonValueKind.Number ? vEl.GetInt32() : 15,
                    n = root.GetProperty("n").GetString() ?? "",
                    c = root.GetProperty("c").GetString() ?? "",
                };
                var r = EnsureRecord();
                var envPriv = Hex(r.envPrivHex);
                try
                {
                    var envKey = DeviceKeysV15.DeriveEnvelopeKey(envPriv, ServerStaticPub);
                    return BodyEnvelope.OpenToJson(env, envKey);
                }
                finally { CryptographicOperations.ZeroMemory(envPriv); }
            }
            catch { return responseText; }
        }

        // ---------------- anti-debug / analysis-tool detection ----------------
        [DllImport("kernel32.dll")] static extern bool IsDebuggerPresent();
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool CheckRemoteDebuggerPresent(IntPtr hProcess, ref bool pbDebuggerPresent);

        static readonly string[] BlockedProcessTokens = new[]
        {
            "cheatengine", "cheat engine", "x64dbg", "x32dbg", "ollydbg", "ida64", "ida32",
            "windbg", "dnspy", "de4dot", "ilspy", "wireshark", "fiddler", "httpdebugger",
            "httpdebuggerui", "charles", "mitmproxy", "burpsuite", "processhacker", "procmon",
            "procexp", "apimonitor", "scylla", "megadumper", "extremedumper", "pe-sieve",
            "ghidra", "dbgview", "reclass", "titanhide", "scyllahide",
        };

        /// Returns the detected tool/debugger name, or "" when clean.
        public static string AntiDebugScan()
        {
            try
            {
                if (IsDebuggerPresent()) return "debugger";
                bool remote = false;
                try { CheckRemoteDebuggerPresent(Process.GetCurrentProcess().Handle, ref remote); } catch { }
                if (remote) return "remote-debugger";
                if (Debugger.IsAttached) return "managed-debugger";

                foreach (var p in Process.GetProcesses())
                {
                    string name;
                    try { name = (p.ProcessName ?? "").ToLowerInvariant(); } catch { continue; }
                    if (string.IsNullOrEmpty(name)) continue;
                    foreach (var tok in BlockedProcessTokens)
                    {
                        if (name.Contains(tok)) return p.ProcessName;
                    }
                }
            }
            catch { /* never crash the app over a scan */ }
            return "";
        }
    }
}
