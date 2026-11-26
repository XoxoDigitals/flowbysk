using System;
using System.IO;
using System.Text;
using System.Text.Json;
using FlowBrowser.Security;

static byte[] Hex(string h)
{
    var b = new byte[h.Length / 2];
    for (int i = 0; i < b.Length; i++) b[i] = Convert.ToByte(h.Substring(i * 2, 2), 16);
    return b;
}
static string HexOf(byte[] b) { var sb = new StringBuilder(); foreach (var x in b) sb.Append(x.ToString("x2")); return sb.ToString(); }

int fails = 0;
void Check(string name, bool ok) { if (!ok) fails++; Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {name}"); }

string vectorsPath = args.Length > 0 ? args[0] : Path.Combine("..", "v15-vectors.json");
using var doc = JsonDocument.Parse(File.ReadAllText(vectorsPath));
var root = doc.RootElement;

// 1) codec encode must match Node exactly
foreach (var c in root.GetProperty("codec").EnumerateArray())
{
    string input = c.GetProperty("inputUtf8").GetString()!;
    byte[] buf = Encoding.UTF8.GetBytes(input);
    Check($"base91 encode {JsonSerializer.Serialize(input)}", Base91.Encode(buf) == c.GetProperty("base91").GetString());
    Check($"base122 encode {JsonSerializer.Serialize(input)}", Base122.Encode(buf) == c.GetProperty("base122").GetString());
    // round-trip
    Check($"base91 roundtrip", Encoding.UTF8.GetString(Base91.Decode(Base91.Encode(buf))) == input);
    Check($"base122 roundtrip", Encoding.UTF8.GetString(Base122.Decode(Base122.Encode(buf))) == input);
}

// 2) open a Node-sealed AES-GCM body
{
    byte[] key = Hex(root.GetProperty("aesKeyHex").GetString()!);
    var sealedEl = root.GetProperty("envelope").GetProperty("sealed");
    var env = new Envelope { v = sealedEl.GetProperty("v").GetInt32(), n = sealedEl.GetProperty("n").GetString()!, c = sealedEl.GetProperty("c").GetString()! };
    string expected = root.GetProperty("envelope").GetProperty("expectedJson").GetString()!;
    string got = BodyEnvelope.OpenToJson(env, key);
    Check("open Node-sealed body == expectedJson", got == expected);
}

// 3) X25519 static ECDH -> envelope key must match Node
{
    var x = root.GetProperty("x25519");
    byte[] devPriv = Hex(x.GetProperty("devicePrivRawHex").GetString()!);
    byte[] srvPub = B64.UrlDecode(x.GetProperty("serverStaticPubRawB64url").GetString()!);
    string got = HexOf(DeviceKeysV15.DeriveEnvelopeKey(devPriv, srvPub));
    Check("envelope key matches Node (static ECDH)", got == x.GetProperty("expectedEnvKeyHex").GetString());
}

// 4) Ed25519 deterministic signature must match Node, and verify
{
    var e = root.GetProperty("ed25519");
    byte[] seed = Hex(e.GetProperty("seedHex").GetString()!);
    byte[] pub = B64.UrlDecode(e.GetProperty("pubRawB64url").GetString()!);
    string msg = e.GetProperty("message").GetString()!;
    string expectedSig = e.GetProperty("expectedSignatureB64url").GetString()!;
    string gotSig = DeviceKeysV15.Sign(seed, msg);
    Check("Ed25519 signature matches Node (deterministic)", gotSig == expectedSig);
    Check("Ed25519 verify valid", DeviceKeysV15.Verify(pub, msg, expectedSig));
    Check("Ed25519 verify tampered rejected", !DeviceKeysV15.Verify(pub, msg + "x", expectedSig));
}

// 5) C# seal -> C# open round-trip
{
    byte[] key = Hex(root.GetProperty("aesKeyHex").GetString()!);
    var obj = new { stage = "password", ts = 1700000000000L, note = "café 🔐" };
    var env = BodyEnvelope.Seal(obj, key);
    string json = BodyEnvelope.OpenToJson(env, key);
    Check("C# seal->open round-trip", json.Contains("password") && json.Contains("caf"));

    // 6) write a C#-sealed blob for Node to open (reverse-direction check)
    var outObj = new { aesKeyHex = root.GetProperty("aesKeyHex").GetString(), env, expectedJson = json };
    File.WriteAllText(Path.Combine(Path.GetDirectoryName(vectorsPath)!, "csharp-sealed.json"), JsonSerializer.Serialize(outObj));
}

Console.WriteLine(fails == 0 ? "\nALL PASS" : $"\n{fails} FAILED");
Environment.Exit(fails == 0 ? 0 : 1);
