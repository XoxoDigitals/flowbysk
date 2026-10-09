# Flow Browser (Android)

Native Android host with dual WebViews — same shell + Flow inject architecture as the Windows WebView2 client.

## Requirements

- JDK 17+
- Android SDK (`compileSdk` / `targetSdk` 35)
- A reachable Flow API server (`/api/v6/client/*`)

## Configure server URL

Default for emulator → host machine:

```
http://10.0.2.2:3000
```

Override in `local.properties`:

```properties
sdk.dir=C\:\\Android\\Sdk
default.server.url=https://your-api.example.com
```

Or at build time:

```bat
gradlew.bat assembleRelease -PDEFAULT_SERVER_URL=https://your-api.example.com
```

Users can also change the URL in the shell UI (persisted in app storage).

## Build

```bat
cd client-android
gradlew.bat assembleDebug
gradlew.bat assembleRelease
```

APKs:

- `app/build/outputs/apk/debug/app-debug.apk`
- `app/build/outputs/apk/release/app-release.apk`

Release signing: if no keystore is configured, release uses the debug keystore (fine for sideload testing).

### Optional release keystore

In `local.properties`:

```properties
RELEASE_STORE_FILE=../keystore/flow-release.jks
RELEASE_STORE_PASSWORD=...
RELEASE_KEY_ALIAS=flowbrowser
RELEASE_KEY_PASSWORD=...
```

## Architecture

| Component | Role |
|-----------|------|
| `WwwServer` | Serves `assets/www` on `http://127.0.0.1:<port>/` |
| Shell WebView | `ui/app-shell.html` + `shell-bridge.js` |
| Flow WebView | Google Flow + `flow-inject.js` |
| `ShellHost` / `FlowHost` | `chrome.webview` polyfill bridges |
| `AppConfig` | Keystore `EncryptedSharedPreferences` (JWT / serverUrl only) |
| `CredChannelHost` | Kotlin X25519 ECDH fallback when WebCrypto is unavailable |

`preBuild` copies `../client-webview2/FlowBrowser/www` → `app/src/main/assets/www` (v6 shell + `cred-channel.js`).

Default server URL: `https://flowcreatorai.site` (override via `local.properties`).

## Manual test checklist

1. Login against `/api/v6/client/login` (expects `channel` + sealed creds)
2. Kill/reopen app — session restores via EncryptedSharedPreferences
3. Shell switches to chrome mode and loads Flow
4. Generate image/video → credit deduct (`/api/v6/client/use-credit`)
5. Server switch / OTP path (if used)
6. Download lands in Downloads and shell gets completed event
7. Logout clears Flow cookies (`clearPartitionSession`) + encrypted session
8. Confirm `filesDir` has no plaintext `flow_client_config.json`

## Notes

- Google may block or challenge sign-in inside Android WebView; auto-login / OTP / captcha IPC from the Windows client is preserved.
- CDP mouse clicks are emulated with `dispatchTouchEvent` + JS `elementFromPoint`.
- Generation network notify is best-effort via `shouldInterceptRequest` URL matching; credit engine JS in `flow-inject.js` remains primary.
