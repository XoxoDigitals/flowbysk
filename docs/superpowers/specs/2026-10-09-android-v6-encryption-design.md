# Android Flow Browser — v6 API + encryption

## Summary

Bring the Android client to parity with Windows Flow Browser **v6**: call `/api/v6/client`, open an ECDH credential channel for sealed Google secrets, and stop storing session JSON in plaintext. Session at rest uses **Android Keystore–backed EncryptedSharedPreferences** (option B). Transit crypto uses **WebCrypto first, Kotlin host ECDH fallback** (option C).

## Decisions (approved)

| Topic | Choice |
|-------|--------|
| Session at rest | EncryptedSharedPreferences + Android Keystore (auto-unlock on device) |
| Cred channel | WebCrypto (`crypto.subtle`) first; Kotlin X25519 + AES-GCM if subtle/X25519 unavailable |
| UI assets | Keep `preBuild` sync from `client-webview2/FlowBrowser/www` |
| Server | No API changes; reuse existing Browser-branch v6 routes |

## Current state (gaps)

- Shell still targets `/api/v2/client` in checked-in Android assets (stale vs Windows www).
- No `cred-channel.js` / host `cred*` bridge on Android.
- `AppConfig.kt` writes plaintext `filesDir/flow_client_config.json`.
- `WwwServer` serves `http://127.0.0.1:<port>/` (secure context — WebCrypto should usually work).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Shell WebView (localhost www)                           │
│  app-shell.js → /api/v6/client                          │
│  cred-channel.js → subtle OR electronAPI.cred*          │
└───────────────┬───────────────────────────┬─────────────┘
                │ HTTPS API                 │ invoke
                ▼                           ▼
        flowcreatorai.site            MainActivity / CredChannelHost
        /api/v6/client/*              X25519 + AES-GCM + HMAC
                                              │
                                              ▼
                                    EncryptedSharedPreferences
                                    (Keystore master key)
                                    JWT, serverUrl, sanitized user
```

## Component changes

### 1. Assets sync

- Rely on existing Gradle `preBuild` copy: `../client-webview2/FlowBrowser/www` → `app/src/main/assets/www`.
- After sync, Android ships Windows v6 shell (`CLIENT_API` v6, `cred-channel.js`, sealed login/`extension-step`).
- Android-specific absolute host URLs: shell already uses `WwwServer` origin; any leftover `flowbrowser.local` links in extensions should resolve via relative paths or localhost base (fix after sync; patch polyfill if needed).

### 2. Shell bridge (`shell-bridge.js` via Windows www)

Windows already exposes:

- `credGenerateKey`, `credEstablish`, `credMac`, `credDecrypt`, `credClear`

Android `MainActivity` / `WebBridges` must implement the same invoke commands so host fallback works when subtle fails.

### 3. Kotlin `CredChannelHost`

Mirror Windows `CredChannelHost.cs` / `flow-cred-v1`:

- Generate X25519 keypair; export raw 32-byte public key as base64url.
- Establish with server SPKI (last 32 bytes = raw public); SHA-256(shared ‖ `flow-cred-v1`) → AES key.
- HMAC-SHA256 for request MAC; AES-256-GCM decrypt sealed payloads (ciphertext = data‖tag).
- Use a well-maintained library (e.g. Google Tink or BouncyCastle) for X25519 on Android.

### 4. Session storage (`AppConfig.kt`)

- Replace plaintext file with `EncryptedSharedPreferences` (`MasterKey` + AES256_GCM).
- Persist only: `serverUrl`, `authToken`, sanitized `user`, sanitized `activeServer` (no Google password/TOTP), `zoomLevel`.
- On first launch after upgrade: if old `flow_client_config.json` exists, migrate once into encrypted prefs then delete the plaintext file.
- `saveSession` / `clearSession` / `getConfig` continue via existing bridge; ignore `vaultPassword` (Windows-only sealing) or accept and discard.

### 5. Login / extension flow (behavior)

Unchanged protocol vs Windows:

1. `POST /login` with `{ username, password, clientPublicKey }`
2. Establish channel from `channel.channelId` + `serverPublicKey`
3. `extension-start` with `channelId`
4. `extension-step` with `{ attemptId, stage, channelId, ts, mac }` → decrypt sealed value in shell

## Out of scope

- Windows EXE / `www.vault` / FBS7 password vault changes
- Server route redesign
- Cookie/v5 inject on Android
- Play Store listing / release signing beyond existing local.properties keystore

## Verification

1. Debug APK login against `https://flowcreatorai.site` → `/api/v6/client/login` succeeds with `channel`.
2. Force WebCrypto off (or broken subtle) → host ECDH still completes login.
3. After kill/reopen app, session restores without re-login (Keystore prefs).
4. `filesDir` has no readable plaintext JWT JSON; old `flow_client_config.json` gone after migrate.
5. `extension-step` response JSON has no plaintext Google password (sealed only); fill still works.
6. Logout clears encrypted session + Flow cookies.

## Risks

| Risk | Mitigation |
|------|------------|
| X25519 missing in some WebViews | Kotlin fallback (required path) |
| Asset sync overwrites Android-only tweaks | Prefer fixing Windows www; document Android-only patches |
| Keystore unavailable (rare/broken devices) | Fail closed to re-login; log once |
| `flowbrowser.local` URLs after sync | Point extensions at relative/`location.origin` or localhost |

## Success criteria

- Android and Windows both speak v6 sealed credentials against the same API.
- No plaintext session file on disk.
- Manual Postman/curl still cannot read Google secrets with JWT alone (server already enforces MAC + channel).
