using System.Security.Cryptography;
using System.Text;
using NSec.Cryptography;

namespace FlowBrowser;

/// <summary>
/// X25519 + AES-GCM credential channel (matches server/credChannel.js flow-cred-v1).
/// Runs in the host so login works even when WebView2 crypto.subtle is unavailable.
/// </summary>
sealed class CredChannelHost : IDisposable
{
    static readonly KeyAgreementAlgorithm X25519 = KeyAgreementAlgorithm.X25519;
    static readonly byte[] Info = Encoding.UTF8.GetBytes("flow-cred-v1");

    Key? _clientKey;
    byte[]? _aesKey;
    string? _channelId;

    public string? ChannelId => _channelId;
    public bool IsReady => _aesKey != null && !string.IsNullOrEmpty(_channelId);

    public string GenerateClientPublicKey()
    {
        DisposeKey();
        _aesKey = null;
        _channelId = null;
        _clientKey = Key.Create(X25519, new KeyCreationParameters
        {
            ExportPolicy = KeyExportPolicies.AllowPlaintextExport
        });
        var raw = _clientKey.PublicKey.Export(KeyBlobFormat.RawPublicKey);
        return ToB64Url(raw);
    }

    public void Establish(string channelId, string serverPublicKeySpkiB64)
    {
        if (_clientKey == null) throw new InvalidOperationException("Generate client key first");
        if (string.IsNullOrWhiteSpace(channelId)) throw new ArgumentException("channelId required");
        var spki = FromB64Url(serverPublicKeySpkiB64);
        if (spki.Length < 32) throw new ArgumentException("Invalid serverPublicKey");
        var serverRaw = spki.AsSpan(spki.Length - 32).ToArray();
        var serverPub = PublicKey.Import(X25519, serverRaw, KeyBlobFormat.RawPublicKey);
        using var shared = X25519.Agree(_clientKey, serverPub, new SharedSecretCreationParameters
        {
            ExportPolicy = KeyExportPolicies.AllowPlaintextExport
        }) ?? throw new CryptographicException("X25519 agree failed");
        var sharedBytes = shared.Export(SharedSecretBlobFormat.RawSharedSecret);
        var material = new byte[sharedBytes.Length + Info.Length];
        Buffer.BlockCopy(sharedBytes, 0, material, 0, sharedBytes.Length);
        Buffer.BlockCopy(Info, 0, material, sharedBytes.Length, Info.Length);
        _aesKey = SHA256.HashData(material);
        _channelId = channelId;
        CryptographicOperations.ZeroMemory(sharedBytes);
        CryptographicOperations.ZeroMemory(material);
    }

    public object Mac(string attemptId, string stage)
    {
        if (_aesKey == null || _channelId == null) throw new InvalidOperationException("Channel not established");
        var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var msg = Encoding.UTF8.GetBytes($"{_channelId}|{attemptId}|{stage}|{ts}");
        var sig = HMACSHA256.HashData(_aesKey, msg);
        return new { ts, mac = ToB64Url(sig) };
    }

    public string DecryptSealed(string ciphertextB64, string nonceB64)
    {
        if (_aesKey == null) throw new InvalidOperationException("Channel not established");
        var packed = FromB64Url(ciphertextB64);
        var nonce = FromB64Url(nonceB64);
        if (packed.Length < 17) throw new ArgumentException("Ciphertext too short");
        var plain = new byte[packed.Length - 16];
        using var gcm = new AesGcm(_aesKey, 16);
        gcm.Decrypt(
            nonce,
            packed.AsSpan(0, packed.Length - 16),
            packed.AsSpan(packed.Length - 16),
            plain);
        return Encoding.UTF8.GetString(plain);
    }

    public void Clear()
    {
        if (_aesKey != null) CryptographicOperations.ZeroMemory(_aesKey);
        _aesKey = null;
        _channelId = null;
        DisposeKey();
    }

    void DisposeKey()
    {
        _clientKey?.Dispose();
        _clientKey = null;
    }

    public void Dispose() => Clear();

    static string ToB64Url(byte[] data) =>
        Convert.ToBase64String(data).Replace('+', '-').Replace('/', '_').TrimEnd('=');

    static byte[] FromB64Url(string s)
    {
        var t = (s ?? "").Replace('-', '+').Replace('_', '/');
        switch (t.Length % 4)
        {
            case 2: t += "=="; break;
            case 3: t += "="; break;
        }
        return Convert.FromBase64String(t);
    }
}
