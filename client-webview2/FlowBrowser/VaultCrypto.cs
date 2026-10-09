using System.Security.Cryptography;
using System.Text;

namespace FlowBrowser;

/// <summary>
/// AES-256-GCM helpers for embedded www vault and session.bin.
/// WWW key is app-derived (not prompted). Session data key is random + DPAPI-wrapped.
/// </summary>
static class VaultCrypto
{
    public const int NonceSize = 12;
    public const int TagSize = 16;
    public const int KeySize = 32;

    /// <summary>Magic for embedded UI vault: FBW6</summary>
    public static readonly byte[] WwwMagic = Encoding.ASCII.GetBytes("FBW6");

    /// <summary>Magic for session vault: FBS6</summary>
    public static readonly byte[] SessionMagic = Encoding.ASCII.GetBytes("FBS6");

    /// <summary>App-derived AES key for the embedded www blob (same derivation in pack-www encrypt).</summary>
    public static byte[] DeriveWwwKey()
    {
        // Stable material — must match tools/encrypt-www.cjs
        var material = Encoding.UTF8.GetBytes(
            "FlowBrowser.WwwVault.v6|XoxoDigitals|AES-256-GCM|do-not-ship-plaintext-www");
        return SHA256.HashData(material);
    }

    public static byte[] EncryptAesGcm(byte[] plain, byte[] key)
    {
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var cipher = new byte[plain.Length];
        var tag = new byte[TagSize];
        using var aes = new AesGcm(key, TagSize);
        aes.Encrypt(nonce, plain, cipher, tag);
        var outBytes = new byte[NonceSize + TagSize + cipher.Length];
        Buffer.BlockCopy(nonce, 0, outBytes, 0, NonceSize);
        Buffer.BlockCopy(tag, 0, outBytes, NonceSize, TagSize);
        Buffer.BlockCopy(cipher, 0, outBytes, NonceSize + TagSize, cipher.Length);
        return outBytes;
    }

    public static byte[] DecryptAesGcm(byte[] packed, byte[] key)
    {
        if (packed.Length < NonceSize + TagSize)
            throw new CryptographicException("Ciphertext too short.");
        var nonce = packed.AsSpan(0, NonceSize);
        var tag = packed.AsSpan(NonceSize, TagSize);
        var cipher = packed.AsSpan(NonceSize + TagSize);
        var plain = new byte[cipher.Length];
        using var aes = new AesGcm(key, TagSize);
        aes.Decrypt(nonce, cipher, tag, plain);
        return plain;
    }

    public static byte[] SealWwwZip(byte[] zipBytes)
    {
        var body = EncryptAesGcm(zipBytes, DeriveWwwKey());
        var all = new byte[WwwMagic.Length + body.Length];
        Buffer.BlockCopy(WwwMagic, 0, all, 0, WwwMagic.Length);
        Buffer.BlockCopy(body, 0, all, WwwMagic.Length, body.Length);
        return all;
    }

    public static byte[] OpenWwwVault(byte[] vaultBytes)
    {
        if (vaultBytes.Length < WwwMagic.Length + NonceSize + TagSize)
            throw new CryptographicException("Invalid www vault.");
        for (var i = 0; i < WwwMagic.Length; i++)
        {
            if (vaultBytes[i] != WwwMagic[i])
                throw new CryptographicException("www vault magic mismatch.");
        }
        var body = new byte[vaultBytes.Length - WwwMagic.Length];
        Buffer.BlockCopy(vaultBytes, WwwMagic.Length, body, 0, body.Length);
        return DecryptAesGcm(body, DeriveWwwKey());
    }

    /// <summary>
    /// Format: magic | u16 wrappedKeyLen | wrappedKey(DPAPI) | nonce|tag|cipher (AES-GCM of JSON).
    /// </summary>
    public static byte[] SealSession(byte[] plainJson)
    {
        var dataKey = RandomNumberGenerator.GetBytes(KeySize);
        var wrappedKey = ProtectedData.Protect(dataKey, optionalEntropy: SessionMagic, DataProtectionScope.CurrentUser);
        var body = EncryptAesGcm(plainJson, dataKey);
        CryptographicOperations.ZeroMemory(dataKey);

        if (wrappedKey.Length > ushort.MaxValue)
            throw new InvalidOperationException("Wrapped key too large.");

        var all = new byte[SessionMagic.Length + 2 + wrappedKey.Length + body.Length];
        var o = 0;
        Buffer.BlockCopy(SessionMagic, 0, all, o, SessionMagic.Length);
        o += SessionMagic.Length;
        all[o++] = (byte)(wrappedKey.Length & 0xff);
        all[o++] = (byte)((wrappedKey.Length >> 8) & 0xff);
        Buffer.BlockCopy(wrappedKey, 0, all, o, wrappedKey.Length);
        o += wrappedKey.Length;
        Buffer.BlockCopy(body, 0, all, o, body.Length);
        return all;
    }

    public static byte[] OpenSession(byte[] sealedBytes)
    {
        if (sealedBytes.Length < SessionMagic.Length + 2 + NonceSize + TagSize)
            throw new CryptographicException("Invalid session vault.");
        for (var i = 0; i < SessionMagic.Length; i++)
        {
            if (sealedBytes[i] != SessionMagic[i])
            {
                // Legacy: raw DPAPI blob (pre-v6)
                return ProtectedData.Unprotect(sealedBytes, optionalEntropy: null, DataProtectionScope.CurrentUser);
            }
        }
        var o = SessionMagic.Length;
        var wkLen = sealedBytes[o] | (sealedBytes[o + 1] << 8);
        o += 2;
        if (wkLen <= 0 || o + wkLen + NonceSize + TagSize > sealedBytes.Length)
            throw new CryptographicException("Corrupt session vault.");
        var wrappedKey = new byte[wkLen];
        Buffer.BlockCopy(sealedBytes, o, wrappedKey, 0, wkLen);
        o += wkLen;
        var body = new byte[sealedBytes.Length - o];
        Buffer.BlockCopy(sealedBytes, o, body, 0, body.Length);
        var dataKey = ProtectedData.Unprotect(wrappedKey, optionalEntropy: SessionMagic, DataProtectionScope.CurrentUser);
        try
        {
            return DecryptAesGcm(body, dataKey);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(dataKey);
        }
    }
}
