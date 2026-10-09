# Android v6 Encryption Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Android speaks `/api/v6/client` with sealed ECDH credentials and Keystore-backed session storage.

**Architecture:** Sync Windows `www` via existing Gradle task; add Kotlin `CredChannelHost` for ECDH fallback; replace plaintext `AppConfig` with EncryptedSharedPreferences.

**Tech Stack:** Kotlin, AndroidX Security Crypto, BouncyCastle (X25519), WebView localhost www.

## Global Constraints

- No server API changes; match `flow-cred-v1` from Windows/server.
- Never persist Google password/TOTP.
- Ignore Windows `vaultPassword` on Android (Keystore instead).

---

### Task 1: Encrypted AppConfig

**Files:**
- Modify: `client-android/app/build.gradle.kts` (security-crypto dep)
- Modify: `client-android/app/src/main/java/com/flowbrowser/app/AppConfig.kt`
- Create: unit-style self-check via migrate path

- [ ] Add `androidx.security:security-crypto`
- [ ] EncryptedSharedPreferences + migrate from `flow_client_config.json`
- [ ] Sanitize activeServer secrets on save

### Task 2: CredChannelHost + bridge

**Files:**
- Create: `client-android/app/src/main/java/com/flowbrowser/app/CredChannelHost.kt`
- Modify: `client-android/app/src/main/java/com/flowbrowser/app/MainActivity.kt` (cred* invokes)
- Modify: `client-android/app/build.gradle.kts` (BouncyCastle)

- [ ] X25519 + AES-GCM + HMAC matching server
- [ ] Wire `credGenerateKey|Establish|Mac|Decrypt|Clear`

### Task 3: Assets + localhost

**Files:**
- Sync via `syncWwwAssets` (Windows www already v6)
- Patch extension bases to `location.origin` if needed after sync
- Bump `versionName` to `6.0.2`

- [ ] Run sync / assembleDebug
- [ ] Confirm `cred-channel.js` + v6 CLIENT_API in assets

### Task 4: Verify

- [ ] `gradlew.bat assembleDebug` succeeds
- [ ] Commit + push Browser
