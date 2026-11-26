// Flow v15 client crypto — C# port of server/cryptoEnvelope.js + server/deviceKeys.js.
// Contract (must match Node byte-for-byte):
//   envelope: JSON -> base64 -> base91 -> base122 -> AES-256-GCM, wire = base64url {v,n,c}
//   envelope key: SHA256( X25519(devPriv, serverStaticPub) || "flow-env-v15" )
//   signature: Ed25519 over "v15|deviceId|METHOD|fullPath|ts|sha256(wireBody.c)"
// This file is copied verbatim into the FlowBrowser (EXE) project after the interop test passes.
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using NSec.Cryptography;

namespace FlowBrowser.Security
{
    public static class B64
    {
        public static string Url(byte[] b) =>
            Convert.ToBase64String(b).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        public static byte[] UrlDecode(string s)
        {
            s = s.Replace('-', '+').Replace('_', '/');
            switch (s.Length % 4) { case 2: s += "=="; break; case 3: s += "="; break; }
            return Convert.FromBase64String(s);
        }
        public static string Std(byte[] b) => Convert.ToBase64String(b);
        public static byte[] StdDecode(string s) => Convert.FromBase64String(s);
    }

    public static class Base91
    {
        const string A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~\"";
        static readonly int[] D = Build();
        static int[] Build() { var d = new int[256]; for (int i = 0; i < 256; i++) d[i] = -1; for (int i = 0; i < A.Length; i++) d[A[i]] = i; return d; }

        public static string Encode(byte[] data)
        {
            int b = 0, n = 0; var sb = new StringBuilder();
            foreach (byte by in data)
            {
                b |= (by & 0xff) << n; n += 8;
                if (n > 13)
                {
                    int v = b & 8191;
                    if (v > 88) { b >>= 13; n -= 13; } else { v = b & 16383; b >>= 14; n -= 14; }
                    sb.Append(A[v % 91]); sb.Append(A[v / 91]);
                }
            }
            if (n != 0) { sb.Append(A[b % 91]); if (n > 7 || b > 90) sb.Append(A[b / 91]); }
            return sb.ToString();
        }

        public static byte[] Decode(string str)
        {
            int v = -1, b = 0, n = 0; var o = new List<byte>();
            foreach (char ch in str)
            {
                if (ch > 255) continue; int c = D[ch]; if (c == -1) continue;
                if (v < 0) { v = c; }
                else
                {
                    v += c * 91; b |= v << n; n += (v & 8191) > 88 ? 13 : 14;
                    do { o.Add((byte)(b & 255)); b >>= 8; n -= 8; } while (n > 7);
                    v = -1;
                }
            }
            if (v >= 0) o.Add((byte)((b | (v << n)) & 255));
            return o.ToArray();
        }
    }

    public static class Base122
    {
        static readonly string A = Build();
        static readonly Dictionary<char, int> D = BuildD();
        static string Build()
        {
            var sb = new StringBuilder();
            for (int c = 33; c <= 126; c++) sb.Append((char)c);
            for (int c = 161; sb.Length < 128; c++) sb.Append((char)c);
            return sb.ToString();
        }
        static Dictionary<char, int> BuildD() { var d = new Dictionary<char, int>(); for (int i = 0; i < A.Length; i++) d[A[i]] = i; return d; }

        public static string Encode(byte[] buf)
        {
            var sb = new StringBuilder(); int acc = 0, nbits = 0, total = 0;
            foreach (byte by in buf)
            {
                acc = (acc << 8) | (by & 0xff); nbits += 8;
                while (nbits >= 7) { nbits -= 7; sb.Append(A[(acc >> nbits) & 0x7f]); total += 7; }
                acc &= (1 << nbits) - 1;
            }
            if (nbits > 0) { sb.Append(A[(acc << (7 - nbits)) & 0x7f]); total += 7; }
            int pad = total - buf.Length * 8;
            return A[pad].ToString() + sb.ToString();
        }

        public static byte[] Decode(string str)
        {
            if (string.IsNullOrEmpty(str)) return Array.Empty<byte>();
            int acc = 0, nbits = 0; var o = new List<byte>();
            for (int i = 1; i < str.Length; i++)
            {
                if (!D.TryGetValue(str[i], out int v)) continue;
                acc = (acc << 7) | v; nbits += 7;
                while (nbits >= 8) { nbits -= 8; o.Add((byte)((acc >> nbits) & 0xff)); }
                acc &= (1 << nbits) - 1;
            }
            return o.ToArray();
        }
    }

    public sealed class Envelope { public int v { get; set; } public string n { get; set; } = ""; public string c { get; set; } = ""; }

    public static class BodyEnvelope
    {
        static string Latin1(byte[] b) { var sb = new StringBuilder(b.Length); foreach (var x in b) sb.Append((char)x); return sb.ToString(); }
        static byte[] Latin1Bytes(string s) { var b = new byte[s.Length]; for (int i = 0; i < s.Length; i++) b[i] = (byte)s[i]; return b; }

        public static Envelope Seal(object obj, byte[] aesKey)
        {
            string json = JsonSerializer.Serialize(obj);
            string s64 = B64.Std(Encoding.UTF8.GetBytes(json));
            string s91 = Base91.Encode(Latin1Bytes(s64));
            string s122 = Base122.Encode(Latin1Bytes(s91));
            byte[] plain = Encoding.UTF8.GetBytes(s122);
            byte[] nonce = RandomNumberGenerator.GetBytes(12);
            byte[] cipher = new byte[plain.Length];
            byte[] tag = new byte[16];
            using (var aes = new AesGcm(aesKey, 16)) aes.Encrypt(nonce, plain, cipher, tag);
            byte[] blob = new byte[cipher.Length + 16];
            Buffer.BlockCopy(cipher, 0, blob, 0, cipher.Length);
            Buffer.BlockCopy(tag, 0, blob, cipher.Length, 16);
            return new Envelope { v = 15, n = B64.Url(nonce), c = B64.Url(blob) };
        }

        public static string OpenToJson(Envelope env, byte[] aesKey)
        {
            byte[] nonce = B64.UrlDecode(env.n);
            byte[] blob = B64.UrlDecode(env.c);
            int clen = blob.Length - 16;
            byte[] cipher = new byte[clen]; byte[] tag = new byte[16];
            Buffer.BlockCopy(blob, 0, cipher, 0, clen);
            Buffer.BlockCopy(blob, clen, tag, 0, 16);
            byte[] plain = new byte[clen];
            using (var aes = new AesGcm(aesKey, 16)) aes.Decrypt(nonce, cipher, tag, plain);
            string s122 = Encoding.UTF8.GetString(plain);
            string s91 = Latin1(Base122.Decode(s122));
            string s64 = Latin1(Base91.Decode(s91));
            return Encoding.UTF8.GetString(B64.StdDecode(s64));
        }

        public static T Open<T>(Envelope env, byte[] aesKey) => JsonSerializer.Deserialize<T>(OpenToJson(env, aesKey))!;
    }

    public static class DeviceKeysV15
    {
        const string ENV_LABEL = "flow-env-v15";
        static readonly KeyAgreementAlgorithm X = KeyAgreementAlgorithm.X25519;
        static readonly SignatureAlgorithm ED = SignatureAlgorithm.Ed25519;

        /// envelope key from device X25519 private (raw32) + server static X25519 public (raw32)
        public static byte[] DeriveEnvelopeKey(byte[] devPrivRaw, byte[] serverStaticPubRaw)
        {
            using var key = Key.Import(X, devPrivRaw, KeyBlobFormat.RawPrivateKey,
                new KeyCreationParameters { ExportPolicy = KeyExportPolicies.AllowPlaintextExport });
            var pub = PublicKey.Import(X, serverStaticPubRaw, KeyBlobFormat.RawPublicKey);
            using var ss = X.Agree(key, pub, new SharedSecretCreationParameters { ExportPolicy = KeyExportPolicies.AllowPlaintextExport })
                ?? throw new CryptographicException("X25519 agree failed");
            byte[] shared = ss.Export(SharedSecretBlobFormat.RawSharedSecret);
            using var sha = SHA256.Create();
            sha.TransformBlock(shared, 0, shared.Length, null, 0);
            byte[] lbl = Encoding.ASCII.GetBytes(ENV_LABEL);
            sha.TransformFinalBlock(lbl, 0, lbl.Length);
            return sha.Hash!;
        }

        /// Ed25519 sign a UTF-8 message with a raw 32-byte seed; returns base64url signature.
        public static string Sign(byte[] seedRaw, string message)
        {
            using var key = Key.Import(ED, seedRaw, KeyBlobFormat.RawPrivateKey);
            byte[] sig = ED.Sign(key, Encoding.UTF8.GetBytes(message));
            return B64.Url(sig);
        }

        public static bool Verify(byte[] pubRaw, string message, string sigB64url)
        {
            try
            {
                var pub = PublicKey.Import(ED, pubRaw, KeyBlobFormat.RawPublicKey);
                return ED.Verify(pub, Encoding.UTF8.GetBytes(message), B64.UrlDecode(sigB64url));
            }
            catch { return false; }
        }

        public static string Sha256B64url(string s)
        {
            using var sha = SHA256.Create();
            return B64.Url(sha.ComputeHash(Encoding.UTF8.GetBytes(s)));
        }
    }
}
