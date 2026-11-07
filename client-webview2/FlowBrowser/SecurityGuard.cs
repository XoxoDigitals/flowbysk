using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;

namespace FlowBrowser;

/// <summary>
/// Runtime Anti-Debugging, Anti-Tamper, SHA-256 Authenticode Verification,
/// and Cryptographic Server Attestation for Flow Browser v11.
/// </summary>
internal static class SecurityGuard
{
    static long _serverClockOffsetMs;
    static int _watchdogStarted;
    static volatile bool _tampered;
    static string? _cachedCertSha256;
    static string? _cachedPubKeySha256;
    static string? _cachedVaultSha256;

    [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
    static extern bool IsDebuggerPresent();

    [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
    static extern bool CheckRemoteDebuggerPresent(IntPtr hProcess, out bool isDebuggerPresent);

    [DllImport("kernel32.dll", ExactSpelling = true)]
    static extern IntPtr GetCurrentProcess();

    [DllImport("ntdll.dll", ExactSpelling = true)]
    static extern int NtQueryInformationProcess(
        IntPtr processHandle,
        int processInformationClass,
        out IntPtr processInformation,
        int processInformationLength,
        out int returnLength);

    [DllImport("wintrust.dll", ExactSpelling = true, PreserveSig = true, CharSet = CharSet.Unicode)]
    static extern uint WinVerifyTrust(IntPtr hwnd, [MarshalAs(UnmanagedType.LPStruct)] Guid pgActionID, IntPtr pWVTData);

    static readonly Guid WinTrustActionGenericVerifyV2 = new("{00AAC56B-CD44-11d0-8CC2-00C04FC295EE}");

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WinTrustFileInfo
    {
        public uint cbStruct;
        public IntPtr pcwszFilePath;
        public IntPtr hFile;
        public IntPtr pgKnownSubject;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WinTrustData
    {
        public uint cbStruct;
        public IntPtr pPolicyCallbackData;
        public IntPtr pSIPClientData;
        public uint dwUIChoice;
        public uint fdwRevocationChecks;
        public uint dwUnionChoice;
        public IntPtr pFile;
        public uint dwStateAction;
        public IntPtr hWVTStateData;
        public IntPtr pwszURLReference;
        public uint dwProvFlags;
        public uint dwUIContext;
        public IntPtr pSignatureSettings;
    }

    static readonly string[] BlockedProcessNames =
    {
        "dnspy", "dnspy-x86", "x64dbg", "x32dbg", "ollydbg", "ida", "ida64", "idaq", "idaq64",
        "windbg", "dbgclr", "de4dot", "ilspy", "dotpeek", "justdecompile", "cheatengine",
        "cheatengine-x86_64", "httpdebuggerui", "httpdebuggersvc", "fiddler", "charles",
        "mitmproxy", "megadumper", "extremedumper", "scylla", "titanhide", "sharpod"
    };

    static readonly string[] BlockedModuleSubstrings =
    {
        "0harmony", "mono.cecil", "dnlib", "frida", "minhook", "detours", "easyhook", "httpdebugger", "sbiedll"
    };

    public static void SetServerTime(long serverTimeMs)
    {
        if (serverTimeMs > 0)
        {
            Interlocked.Exchange(ref _serverClockOffsetMs, serverTimeMs - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        }
    }

    public static long GetSyncedTimestampMs()
    {
        return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + Interlocked.Read(ref _serverClockOffsetMs);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void InitializeAndEnforce()
    {
#if !DEBUG
        if (DetectDebuggerOrHooks() || !VerifyBinaryIntegrity())
        {
            _tampered = true;
            Environment.FailFast("Security integrity check failed.");
            return;
        }

        if (Interlocked.CompareExchange(ref _watchdogStarted, 1, 0) == 0)
        {
            var t = new Thread(WatchdogLoop)
            {
                IsBackground = true,
                Name = "FB.Guard",
                Priority = ThreadPriority.BelowNormal
            };
            t.Start();
        }
#else
        _ = VerifyBinaryIntegrity();
#endif
    }

    static void WatchdogLoop()
    {
        while (true)
        {
            try
            {
                Thread.Sleep(3500);
#if !DEBUG
                if (DetectDebuggerOrHooks() || DetectForbiddenProcesses())
                {
                    _tampered = true;
                    Environment.FailFast("Runtime security violation.");
                    return;
                }
#endif
            }
            catch
            {
                // Ignore transient process enumeration errors
            }
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static bool DetectDebuggerOrHooks()
    {
        try
        {
            if (Debugger.IsAttached || Debugger.IsLogging())
                return true;

            if (IsDebuggerPresent())
                return true;

            if (CheckRemoteDebuggerPresent(GetCurrentProcess(), out var remoteDbg) && remoteDbg)
                return true;

            // ProcessDebugPort (7)
            if (NtQueryInformationProcess(GetCurrentProcess(), 7, out var debugPort, IntPtr.Size, out _) == 0 &&
                debugPort != IntPtr.Zero)
            {
                return true;
            }

            // ProcessDebugObjectHandle (30)
            if (NtQueryInformationProcess(GetCurrentProcess(), 30, out var debugObj, IntPtr.Size, out _) == 0 &&
                debugObj != IntPtr.Zero)
            {
                return true;
            }

            // Inspect loaded modules for injection/patching frameworks
            using var proc = Process.GetCurrentProcess();
            foreach (ProcessModule mod in proc.Modules)
            {
                var name = (mod.ModuleName ?? "").ToLowerInvariant();
                for (var i = 0; i < BlockedModuleSubstrings.Length; i++)
                {
                    if (name.Contains(BlockedModuleSubstrings[i], StringComparison.Ordinal))
                        return true;
                }
            }
        }
        catch
        {
            // Ignore P/Invoke restricted environments
        }

        return false;
    }

    static bool DetectForbiddenProcesses()
    {
        try
        {
            var procs = Process.GetProcesses();
            for (var i = 0; i < procs.Length; i++)
            {
                using var p = procs[i];
                string pname;
                try { pname = (p.ProcessName ?? "").ToLowerInvariant(); }
                catch { continue; }

                for (var j = 0; j < BlockedProcessNames.Length; j++)
                {
                    if (pname == BlockedProcessNames[j])
                        return true;
                }
            }
        }
        catch
        {
            // Ignore
        }
        return false;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static bool VerifyBinaryIntegrity()
    {
        try
        {
            var exePath = Environment.ProcessPath;
            var dllPath = typeof(SecurityGuard).Assembly.Location;

            // Compute embedded vault SHA-256
            var vaultSha = ComputeEmbeddedVaultSha256();
            if (string.IsNullOrEmpty(vaultSha))
            {
                _tampered = true;
                return false;
            }
            _cachedVaultSha256 = vaultSha;

            var targetPath = !string.IsNullOrWhiteSpace(exePath) && File.Exists(exePath) ? exePath : dllPath;
            if (string.IsNullOrWhiteSpace(targetPath) || !File.Exists(targetPath))
            {
                _tampered = true;
                return false;
            }

            // 1. Verify PE Authenticode digest via WinVerifyTrust (rejects any modified byte)
            if (!VerifyPeAuthenticodeDigest(targetPath))
            {
                // Fallback check on Flow Browser.dll if exe is apphost in dev
                if (string.IsNullOrWhiteSpace(dllPath) || !File.Exists(dllPath) || !VerifyPeAuthenticodeDigest(dllPath))
                {
                    _tampered = true;
                    return false;
                }
                targetPath = dllPath;
            }

            // 2. Extract X.509 Authenticode signer certificate and verify thumbprint & public key
            using var baseCert = X509Certificate.CreateFromSignedFile(targetPath);
            using var cert2 = new X509Certificate2(baseCert);

            var certSha256 = Convert.ToHexString(SHA256.HashData(cert2.RawData)).ToLowerInvariant();
            var pubKeySha256 = Convert.ToHexString(SHA256.HashData(cert2.GetPublicKey())).ToLowerInvariant();

            // Verify against XOR-reconstructed official publisher certificate SHA-256
            if (!string.Equals(certSha256, GetExpectedWinCertSha256(), StringComparison.Ordinal) ||
                !string.Equals(pubKeySha256, GetExpectedWinPubKeySha256(), StringComparison.Ordinal))
            {
                _tampered = true;
                return false;
            }

            _cachedCertSha256 = certSha256;
            _cachedPubKeySha256 = pubKeySha256;
            return true;
        }
        catch
        {
            _tampered = true;
            return false;
        }
    }

    static bool VerifyPeAuthenticodeDigest(string filePath)
    {
        IntPtr filePtr = IntPtr.Zero;
        IntPtr dataPtr = IntPtr.Zero;
        IntPtr pathPtr = IntPtr.Zero;
        try
        {
            pathPtr = Marshal.StringToCoTaskMemUni(filePath);
            var fileInfo = new WinTrustFileInfo
            {
                cbStruct = (uint)Marshal.SizeOf<WinTrustFileInfo>(),
                pcwszFilePath = pathPtr,
                hFile = IntPtr.Zero,
                pgKnownSubject = IntPtr.Zero
            };
            filePtr = Marshal.AllocCoTaskMem(Marshal.SizeOf<WinTrustFileInfo>());
            Marshal.StructureToPtr(fileInfo, filePtr, false);

            var wvtData = new WinTrustData
            {
                cbStruct = (uint)Marshal.SizeOf<WinTrustData>(),
                pPolicyCallbackData = IntPtr.Zero,
                pSIPClientData = IntPtr.Zero,
                dwUIChoice = 2, // WTD_UI_NONE
                fdwRevocationChecks = 0, // WTD_REVOKE_NONE
                dwUnionChoice = 1, // WTD_CHOICE_FILE
                pFile = filePtr,
                dwStateAction = 0, // WTD_STATEACTION_IGNORE
                hWVTStateData = IntPtr.Zero,
                pwszURLReference = IntPtr.Zero,
                dwProvFlags = 0x00000010 | 0x00000080, // WTD_HASH_ONLY_FLAG | WTD_REVOCATION_CHECK_NONE
                dwUIContext = 0,
                pSignatureSettings = IntPtr.Zero
            };
            dataPtr = Marshal.AllocCoTaskMem(Marshal.SizeOf<WinTrustData>());
            Marshal.StructureToPtr(wvtData, dataPtr, false);

            uint status = WinVerifyTrust(IntPtr.Zero, WinTrustActionGenericVerifyV2, dataPtr);
            // 0 = ERROR_SUCCESS
            // 0x800B0109 = CERT_E_UNTRUSTEDROOT (cryptographic PE SHA-256 digest is 100% intact, self-signed root not in machine store)
            // 0x800B010A = CERT_E_CHAINING
            // Any modification to the EXE/DLL returns 0x80096010 (TRUST_E_BAD_DIGEST) or 0x800B0100 (TRUST_E_NOSIGNATURE)!
            return status == 0 || status == 0x800B0109u || status == 0x800B010Au;
        }
        catch
        {
            return false;
        }
        finally
        {
            if (dataPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(dataPtr);
            if (filePtr != IntPtr.Zero) Marshal.FreeCoTaskMem(filePtr);
            if (pathPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(pathPtr);
        }
    }

    static string ComputeEmbeddedVaultSha256()
    {
        try
        {
            var asm = Assembly.GetExecutingAssembly();
            using var s = asm.GetManifestResourceStream("FlowBrowser.www.vault");
            if (s == null) return "";
            using var ms = new MemoryStream();
            s.CopyTo(ms);
            var bytes = ms.ToArray();
            if (bytes.Length < 32 || bytes[0] != (byte)'F' || bytes[1] != (byte)'B' || bytes[2] != (byte)'W' || bytes[3] != (byte)'6')
                return "";
            return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        }
        catch
        {
            return "";
        }
    }

    /// <summary>Reconstructs 32-byte MasterSeed in memory (never stored as plaintext string).</summary>
    static byte[] DeriveMasterSeed()
    {
        ReadOnlySpan<byte> mask = new byte[]
        {
            0x93, 0x4A, 0xE7, 0x12, 0xC8, 0x55, 0x3B, 0xF0, 0x6D, 0xA1, 0x29, 0x84, 0x7E, 0xDF, 0x16, 0x43,
            0xB2, 0x0C, 0x89, 0xE5, 0x31, 0x74, 0xFA, 0x68, 0x9C, 0x5E, 0xD0, 0x27, 0x4B, 0xA6, 0x1F, 0x82
        };
        ReadOnlySpan<byte> xored = new byte[]
        {
            0xF5, 0x26, 0x88, 0x65, 0x97, 0x16, 0x49, 0x95, 0x0C, 0xD5, 0x46, 0xF6, 0x53, 0xBE, 0x7F, 0x6E,
            0xC4, 0x3D, 0xB8, 0xBA, 0x52, 0x1B, 0x9E, 0x0D, 0xEB, 0x37, 0xBA, 0x49, 0x38, 0xC9, 0x71, 0xF1
        };
        var seed = new byte[32];
        for (var i = 0; i < 32; i++)
            seed[i] = (byte)(xored[i] ^ mask[i]);
        return seed;
    }

    static string GetExpectedWinCertSha256()
    {
        // 6103eb912192c3cf0302d302fd4a36ee35fc71c066eebd80620806610264d2de
        ReadOnlySpan<byte> raw = new byte[]
        {
            0x61, 0x03, 0xeb, 0x91, 0x21, 0x92, 0xc3, 0xcf, 0x03, 0x02, 0xd3, 0x02, 0xfd, 0x4a, 0x36, 0xee,
            0x35, 0xfc, 0x71, 0xc0, 0x66, 0xee, 0xbd, 0x80, 0x62, 0x08, 0x06, 0x61, 0x02, 0x64, 0xd2, 0xde
        };
        return Convert.ToHexString(raw).ToLowerInvariant();
    }

    static string GetExpectedWinPubKeySha256()
    {
        // 2df97068899b17a9abf82263f141e6f4beae4708265feb9a160e9fa83ff24720
        ReadOnlySpan<byte> raw = new byte[]
        {
            0x2d, 0xf9, 0x70, 0x68, 0x89, 0x9b, 0x17, 0xa9, 0xab, 0xf8, 0x22, 0x63, 0xf1, 0x41, 0xe6, 0xf4,
            0xbe, 0xae, 0x47, 0x08, 0x26, 0x5f, 0xeb, 0x9a, 0x16, 0x0e, 0x9f, 0xa8, 0x3f, 0xf2, 0x47, 0x20
        };
        return Convert.ToHexString(raw).ToLowerInvariant();
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static object CreateClientAttestation(string deviceId, string appVersion, long? explicitServerTimeMs = null)
    {
        if (explicitServerTimeMs.HasValue && explicitServerTimeMs.Value > 0)
            SetServerTime(explicitServerTimeMs.Value);

        if (_cachedCertSha256 == null || _cachedPubKeySha256 == null || _cachedVaultSha256 == null)
            VerifyBinaryIntegrity();

#if !DEBUG
        if (DetectDebuggerOrHooks())
            _tampered = true;
#endif

        var certSha = _tampered ? "0000000000000000000000000000000000000000000000000000000000000000" : (_cachedCertSha256 ?? "none");
        var pubSha = _tampered ? "0000000000000000000000000000000000000000000000000000000000000000" : (_cachedPubKeySha256 ?? "none");
        var vaultSha = _cachedVaultSha256 ?? "0000000000000000";

        var client = "windows-exe/" + appVersion;
        var binHash = $"win:{(certSha.Length >= 16 ? certSha[..16] : certSha)}:{(pubSha.Length >= 16 ? pubSha[..16] : pubSha)}:{(vaultSha.Length >= 16 ? vaultSha[..16] : vaultSha)}";
        var ts = GetSyncedTimestampMs();
        var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(12)).ToLowerInvariant();

        var seed = DeriveMasterSeed();
        var suffix = Encoding.UTF8.GetBytes($"|win|{certSha}|{pubSha}");
        var keyMaterial = new byte[seed.Length + suffix.Length];
        Buffer.BlockCopy(seed, 0, keyMaterial, 0, seed.Length);
        Buffer.BlockCopy(suffix, 0, keyMaterial, seed.Length, suffix.Length);
        var signingKey = SHA256.HashData(keyMaterial);
        CryptographicOperations.ZeroMemory(seed);
        CryptographicOperations.ZeroMemory(keyMaterial);

        var msg = Encoding.UTF8.GetBytes($"v11|{client}|{deviceId}|{binHash}|{ts}|{nonce}");
        var mac = HMACSHA256.HashData(signingKey, msg);
        CryptographicOperations.ZeroMemory(signingKey);

        var sigB64 = Convert.ToBase64String(mac).Replace('+', '-').Replace('/', '_').TrimEnd('=');

        return new
        {
            deviceId,
            client,
            version = appVersion,
            binHash,
            ts,
            nonce,
            signature = sigB64
        };
    }
}

