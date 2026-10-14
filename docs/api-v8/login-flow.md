# Full v8 app login flow — request → response

Base: `https://flowcreatorai.site`

Common app headers:

```http
Content-Type: application/json
X-Flow-Client: windows-exe/8.0.0
```

---

## STEP 1 — App password login

```http
POST /api/v8/client/login
X-Flow-Client: windows-exe/8.0.0
```

```json
{
  "username": "testuser",
  "password": "secret",
  "deviceId": "test-device-id-00123456789",
  "clientPublicKey": "<base64url-x25519-public-key-from-app>"
}
```

**Response `200`:** `token`, `user`, `servers`, `activeServer`, `channel` (`channelId`, `serverPublicKey`).  
**Activity:** `client_login`

Missing device / bad client → `403 SUSPICIOUS_CLIENT`.  
Missing `clientPublicKey` on app path → `400 CHANNEL_REQUIRED`.

Old clients hitting `/api/v7/client/...` → `410 FORCE_UPDATE`.

---

## STEP 2 — `/me`

```http
GET /api/v8/client/me
Authorization: Bearer <token>
```

User payload includes lock fields when active:

```json
{
  "success": true,
  "user": {
    "username": "testuser",
    "googleSessionLocked": true,
    "googleSessionLockUntil": "2026-10-12T16:00:00.000Z",
    "googleSessionRetryAfterSeconds": 3400
  }
}
```

---

## STEP 3 — extension-start

```http
POST /api/v8/client/extension-start
Authorization: Bearer <token>
```

```json
{ "channelId": "ch_xxx" }
```

**Response `200`:** `attemptId`, `assignedAccount`.  
**Activity:** `extension_login_start`

If still inside 60m lock after a prior success → `429 GOOGLE_SESSION_LOCKED`.

---

## STEP 4 — extension-step (email | password | otp)

Requires HMAC `ts` + `mac` from the channel (app only). Returns sealed ciphertext — never plaintext.

**Activity:** `extension_step`

---

## STEP 5 — extension-finish

```http
POST /api/v8/client/extension-finish
Authorization: Bearer <token>
```

```json
{ "attemptId": "att_xxx", "outcome": "success" }
```

**Response `200`:** `{ "success": true, "user": { ... lock fields ... } }`  
On `outcome: "success"` the server sets `googleSessionLockUntil = now + 60 minutes`.  
**Activity:** `extension_login_finish` (includes `lockedUntil` when success)

---

## After success — blocked for 60 minutes

| Endpoint | During lock |
|---|---|
| `POST /switch-server` | `429 GOOGLE_SESSION_LOCKED` |
| `POST /request-server-change` | `429 GOOGLE_SESSION_LOCKED` |
| `POST /extension-start` | `429 GOOGLE_SESSION_LOCKED` |
| `/me`, `/use-credit`, `/verify-session` | Allowed |

```json
{
  "success": false,
  "code": "GOOGLE_SESSION_LOCKED",
  "error": "Wait before changing server or starting a new Google login.",
  "lockedUntil": "...",
  "retryAfterSeconds": 1234
}
```

---

## Admin login timeline

`GET /api/admin/logs/login-sessions?username=&from=&to=`  
Groups by `attemptId`: start → steps (counts) → finish outcome.  
Admin UI: **Activity Logs → Login timeline** tab.
