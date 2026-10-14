# v8 security and 60‑minute lock

## What is real security (server-side)

1. **Device attestation** on `/api/v8/client/login` — requires `X-Flow-Client: windows-exe/…` or `android/…` plus a valid `deviceId`.
2. **Ephemeral ECDH channel** — `clientPublicKey` is unique every login; Google email/password/OTP only leave the server sealed.
3. **HMAC on extension-step** — forged Postman steps fail with `BAD_MAC`.
4. **API cutover** — v2–v7 return `410 FORCE_UPDATE`.
5. **60‑minute Google session lock** after `extension_login_finish` success — blocks switch-server, request-server-change, and a new extension-start.
6. **DevTools disabled** on the Flow/Google WebView2 (`AreDevToolsEnabled = false`, `AreBrowserAcceleratorKeysEnabled = false`) so F12 cannot read the password field in the official EXE.

## What is NOT a secret

The www vault AES string baked into the EXE (`FlowBrowser.WwwVault.v6|XoxoDigitals|…`) is **obfuscation only**. Anyone can extract it and unpack the embedded JS. Do not treat it as confidentiality. Protocol constants in the JS (`flow-cred-v1`, endpoints, client header values) are also readable after unpack — protection must remain on the server.

## Website vs app

| Path | Device ID | Purpose |
|---|---|---|
| `POST /api/session/login` | Not required | Website / admin / reseller |
| `POST /api/v8/client/login` | Required | Official EXE / APK |
