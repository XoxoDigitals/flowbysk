using System.Security.Cryptography;
using System.Text;

namespace FlowBrowser;

/// <summary>
/// In-memory hardening helpers.
///
/// <para><b>SecretBox</b> keeps a secret (Google email / password) encrypted at rest in
/// RAM via DPAPI (CurrentUser + per-box random entropy). The plaintext only exists as a
/// transient during <see cref="SecretBox.Reveal"/> at the exact moment it is injected, and
/// every intermediate byte buffer is zeroed. This defeats idle memory dumps and string
/// searches of the running process &mdash; the plaintext is not sitting in the heap between
/// uses. (A managed string produced at the instant of injection is unavoidable and cannot be
/// zeroed; that sub-millisecond window is the residual exposure.)</para>
///
/// <para><b>Ob</b> decodes XOR+Base64-obfuscated UI / overlay literals so sensitive-looking
/// copy ("Signing you in…", etc.) is not a plaintext string in the binary or in idle RAM.</para>
/// </summary>
static class MemGuard
{
    // Obfuscation key for UI strings (NOT a secret — just keeps literals out of plain view).
    static readonly byte[] UiKey = { 0x5c, 0xa3, 0x17, 0xe8, 0x4b, 0x9d, 0x2f, 0x60, 0xd1, 0x3a, 0x86, 0xf4, 0x08, 0xbb, 0x7e, 0x52 };

    /// <summary>Decode an XOR+Base64 UI literal produced by <see cref="Enc"/>.</summary>
    public static string Ob(string packed)
    {
        try
        {
            var data = Convert.FromBase64String(packed);
            for (var i = 0; i < data.Length; i++) data[i] ^= UiKey[i % UiKey.Length];
            var s = Encoding.UTF8.GetString(data);
            CryptographicOperations.ZeroMemory(data);
            return s;
        }
        catch
        {
            return "";
        }
    }

    /// <summary>Build-time helper to produce the packed literal for <see cref="Ob"/>. Unused at runtime.</summary>
    public static string Enc(string plain)
    {
        var data = Encoding.UTF8.GetBytes(plain);
        for (var i = 0; i < data.Length; i++) data[i] ^= UiKey[i % UiKey.Length];
        return Convert.ToBase64String(data);
    }
}

/// <summary>
/// Holds a secret encrypted in memory (DPAPI). Never stores the plaintext in a field.
/// </summary>
sealed class SecretBox
{
    byte[]? _protected;
    byte[]? _entropy;

    public bool HasValue => _protected != null && _protected.Length > 0;

    /// <summary>Encrypt and store a secret; clears any previous value and zeroes the input bytes.</summary>
    public void Set(string? plain)
    {
        Clear();
        if (string.IsNullOrEmpty(plain)) return;
        var bytes = Encoding.UTF8.GetBytes(plain);
        try
        {
            _entropy = RandomNumberGenerator.GetBytes(16);
            _protected = ProtectedData.Protect(bytes, _entropy, DataProtectionScope.CurrentUser);
        }
        catch
        {
            // DPAPI unavailable (rare) — fall back to a lightweight XOR so plaintext still
            // isn't stored verbatim; better than a plain managed string field.
            _entropy = RandomNumberGenerator.GetBytes(bytes.Length);
            var x = new byte[bytes.Length];
            for (var i = 0; i < bytes.Length; i++) x[i] = (byte)(bytes[i] ^ _entropy[i]);
            _protected = x;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
        }
    }

    /// <summary>Decrypt to a transient string for immediate one-shot use. Returns "" if empty.</summary>
    public string Reveal()
    {
        if (_protected == null) return "";
        byte[]? plain = null;
        try
        {
            try
            {
                plain = ProtectedData.Unprotect(_protected, _entropy, DataProtectionScope.CurrentUser);
            }
            catch
            {
                // XOR fallback path (see Set)
                if (_entropy != null && _entropy.Length == _protected.Length)
                {
                    plain = new byte[_protected.Length];
                    for (var i = 0; i < plain.Length; i++) plain[i] = (byte)(_protected[i] ^ _entropy[i]);
                }
            }
            if (plain == null) return "";
            return Encoding.UTF8.GetString(plain);
        }
        catch
        {
            return "";
        }
        finally
        {
            if (plain != null) CryptographicOperations.ZeroMemory(plain);
        }
    }

    public void Clear()
    {
        if (_protected != null) CryptographicOperations.ZeroMemory(_protected);
        if (_entropy != null) CryptographicOperations.ZeroMemory(_entropy);
        _protected = null;
        _entropy = null;
    }
}
