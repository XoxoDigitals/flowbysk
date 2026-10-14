# Full v7 app login flow — request → response

Base: `https://flowcreatorai.site`

Common app headers (unless noted):

```http
Content-Type: application/json
X-Flow-Client: windows-exe/7.0.0
```

Android uses `X-Flow-Client: android/2.4.0` (or current app version).  
`deviceId`: 16–128 chars, `[A-Za-z0-9._:-]+`.

Replace placeholders with your own test account. Do not use production user passwords in shared docs.

---

## STEP 0 — Security rejects (before a real login)

### 0A — No client header / no device

```http
POST /api/v7/client/login
Content-Type: application/json
```

**Body**

```json
{
  "username": "testuser",
  "password": "secret"
}
```

**Response `403`**

```json
{
  "success": false,
  "code": "SUSPICIOUS_CLIENT",
  "error": "Official app client required.",
  "autoBanned": false
}
```

### 0B — Client header present, missing `deviceId`

```http
POST /api/v7/client/login
Content-Type: application/json
X-Flow-Client: windows-exe/7.0.0
```

**Body**

```json
{
  "username": "testuser",
  "password": "secret"
}
```

**Response `403`**

```json
{
  "success": false,
  "code": "SUSPICIOUS_CLIENT",
  "error": "Device ID required for app login.",
  "autoBanned": false
}
```

### 0C — Device OK, missing secure channel key

```http
POST /api/v7/client/login
Content-Type: application/json
X-Flow-Client: windows-exe/7.0.0
```

**Body**

```json
{
  "username": "testuser",
  "password": "secret",
  "deviceId": "test-device-id-00123456789"
}
```

**Response `400`**

```json
{
  "success": false,
  "code": "CHANNEL_REQUIRED",
  "error": "Secure channel required. Update Flow Browser."
}
```

---

## STEP 1 — App password login

```http
POST /api/v7/client/login
Content-Type: application/json
X-Flow-Client: windows-exe/7.0.0
```

**Body**

```json
{
  "username": "testuser",
  "password": "secret",
  "deviceId": "test-device-id-00123456789",
  "clientPublicKey": "<base64url-x25519-public-key-from-app>"
}
```

`clientPublicKey` is generated fresh by the app each login — see [client-public-key.md](./client-public-key.md).

**Response `200`**

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "username": "testuser",
    "displayName": "",
    "credits": 100,
    "planExpiry": "2026-12-01T00:00:00.000Z",
    "isActive": true,
    "banned": false,
    "maxParallel": 1,
    "plan": "Standard",
    "resellerId": null,
    "ownerLabel": null,
    "activeServerId": "server-uuid"
  },
  "servers": [
    { "id": "server-uuid", "name": "Google-1" }
  ],
  "activeServer": {
    "id": "server-uuid",
    "name": "Google-1",
    "targetUrl": "https://flow.google.com",
    "emailMasked": "g***@gmail.com",
    "hasTotp": true
  },
  "settings": {},
  "channel": {
    "channelId": "ch_xxx",
    "serverPublicKey": "<base64>",
    "expiresInSeconds": 3600
  }
}
```

**Activity log:** `client_login` (includes `ip`, `country`, `deviceId`, `client`, `channelId`)

Save: `token`, `channel.channelId`.

### Other STEP 1 errors

**Wrong password — `401`**

```json
{ "success": false, "error": "Invalid username or password" }
```

**Banned / inactive — `403`**

```json
{ "success": false, "error": "Your account is deactivated. Contact administrator." }
```

**Plan expired — `403`**

```json
{
  "success": false,
  "code": "PLAN_EXPIRED",
  "error": "Your subscription plan expired on ..."
}
```

**No credits — `403`**

```json
{
  "success": false,
  "code": "NO_CREDITS",
  "error": "You have no credits left. Please renew your credits to continue."
}
```

---

## STEP 2 — Verify session (`/me`)

```http
GET /api/v7/client/me
Authorization: Bearer <token from step 1>
```

**Body:** none

**Response `200`**

```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "username": "testuser",
    "displayName": "",
    "credits": 100,
    "planExpiry": "2026-12-01T00:00:00.000Z",
    "isActive": true,
    "banned": false,
    "maxParallel": 1,
    "plan": "Standard",
    "resellerId": null,
    "ownerLabel": null,
    "activeServerId": "server-uuid",
    "activeServerName": "Google-1",
    "activeServerEmailMasked": "g***@gmail.com"
  }
}
```

**Missing / bad token — `401`**

```json
{ "success": false, "error": "Authentication required" }
```

**Logged in elsewhere (session version bump) — `401`**

```json
{
  "success": false,
  "code": "SESSION_REPLACED",
  "error": "Logged in on another device. Please sign in again."
}
```

---

## STEP 2b — Re-open channel (after EXE restart with saved JWT)

```http
POST /api/v7/client/channel-open
Authorization: Bearer <token>
Content-Type: application/json
X-Flow-Client: windows-exe/7.0.0
```

**Body**

```json
{
  "clientPublicKey": "<new-base64url-x25519-public-key>"
}
```

**Response `200`**

```json
{
  "success": true,
  "channel": {
    "channelId": "ch_yyy",
    "serverPublicKey": "<base64>",
    "expiresInSeconds": 3600
  }
}
```

---

## STEP 3 — Start Google auto-login

```http
POST /api/v7/client/extension-start
Authorization: Bearer <token>
Content-Type: application/json
X-Flow-Client: windows-exe/7.0.0
```

**Body**

```json
{
  "channelId": "ch_xxx"
}
```

**Response `200`**

```json
{
  "attemptId": "att_xxx",
  "expiresAt": "2026-10-12T15:00:00.000Z",
  "assignedAccount": {
    "emailMasked": "g***@gmail.com",
    "hasTotp": true
  }
}
```

**Activity log:** `extension_login_start`

**No / invalid channel — `401`**

```json
{
  "success": false,
  "code": "CHANNEL_REQUIRED",
  "error": "Open a secure channel first (login or /channel-open)."
}
```

**No Google account assigned — `400`**

```json
{
  "success": false,
  "error": "No Google account is assigned. Ask the administrator to configure a server with Google credentials."
}
```

---

## STEP 4 — Sealed credential steps (email → password → otp)

Only the official app can do this correctly. Each request needs an HMAC (`ts` + `mac`) from the channel AES key.

```http
POST /api/v7/client/extension-step
Authorization: Bearer <token>
Content-Type: application/json
X-Flow-Client: windows-exe/7.0.0
```

**Body**

```json
{
  "channelId": "ch_xxx",
  "attemptId": "att_xxx",
  "stage": "email",
  "ts": 1791805200000,
  "mac": "<hmac-base64url-from-app>"
}
```

`stage`: `"email"` | `"password"` | `"otp"`  
(Repeat once per stage, in order. App derives `mac`.)

**Response `200`** (never plaintext)

```json
{
  "sealed": true,
  "alg": "AES-GCM",
  "nonce": "<base64url>",
  "ciphertext": "<base64url>"
}
```

OTP may also include:

```json
{
  "sealed": true,
  "alg": "AES-GCM",
  "nonce": "<base64url>",
  "ciphertext": "<base64url>",
  "expiresAt": "2026-10-12T15:00:30.000Z"
}
```

**Activity log:** `extension_step` (`stage`, `sealed: true`)

### STEP 4 errors

**Bad / expired MAC — `403`**

```json
{
  "success": false,
  "code": "BAD_MAC",
  "error": "Request signature invalid or expired."
}
```

**Rate limited — `429`**

```json
{
  "success": false,
  "error": "Too many credential requests. Try again shortly."
}
```

**Invalid stage — `400`**

```json
{
  "success": false,
  "error": "Invalid credential stage."
}
```

---

## STEP 5 — Finish Google login

```http
POST /api/v7/client/extension-finish
Authorization: Bearer <token>
Content-Type: application/json
```

**Body**

```json
{
  "attemptId": "att_xxx",
  "outcome": "success"
}
```

Other outcomes: `"cancelled"`, `"failed"`, or whatever the app sends.

**Response `200`**

```json
{ "success": true }
```

**Activity log:** `extension_login_finish` ← **Google login completed** when `outcome` is success.

---

## Website login (no app attestation)

Not part of the EXE flow, but useful to compare.

```http
POST /api/session/login
Content-Type: application/json
```

**Body**

```json
{
  "username": "testuser",
  "password": "secret"
}
```

**Response `200` (customer)**

```json
{
  "success": true,
  "role": "user",
  "token": "...",
  "user": {},
  "servers": [],
  "activeServer": {},
  "settings": {}
}
```

No `X-Flow-Client`, `deviceId`, or `clientPublicKey`. Website does **not** call extension-start/step/finish.

Admin / reseller get `role: "admin"` or `"reseller"` instead.

---

## End-to-end diagram

```
1. POST /api/v7/client/login
      → Activity: client_login
      → JWT + channelId + serverPublicKey

2. GET  /api/v7/client/me
      → confirms token / sessionVersion

3. POST /api/v7/client/extension-start
      → Activity: extension_login_start
      → attemptId

4. POST /api/v7/client/extension-step  (email, then password, then otp)
      → Activity: extension_step
      → sealed ciphertext only

5. POST /api/v7/client/extension-finish  { "outcome": "success" }
      → Activity: extension_login_finish
      → FULL LOGIN COMPLETED
```

| Activity Logs | Meaning |
|---|---|
| only `client_login` | App API login OK; Google not finished |
| `extension_login_start` without `finish` | Started Google; did **not** complete |
| `extension_login_finish` + success | Full login completed |
