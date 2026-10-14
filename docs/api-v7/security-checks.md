# v7 security checks — manual API tests

Use these to verify device attestation and API cutover. Base: `https://flowcreatorai.site`

## How security is split

| Path | Device ID / `X-Flow-Client` | Purpose |
|---|---|---|
| `POST /api/session/login` | **Not required** | Website / admin / reseller portal |
| `POST /api/v7/client/login` | **Required** | Official EXE / APK only |
| `POST /api/v6/client/...` | — | Dead → `410 FORCE_UPDATE` |

App `X-Flow-Client` must match: `windows-exe/...` or `android/...`  
(`REQUIRE_DEVICE_ID` defaults to on; set `0` on server to disable.)

---

## Test A — Website login (allowed without device)

```http
POST /api/session/login
Content-Type: application/json
```

```json
{
  "username": "YOUR_TEST_USER",
  "password": "YOUR_PASSWORD"
}
```

**Expect:** `200` + `token` + `role`.

---

## Test B — App login blocked (no device)

```http
POST /api/v7/client/login
Content-Type: application/json
X-Flow-Client: windows-exe/7.0.0
```

```json
{
  "username": "YOUR_TEST_USER",
  "password": "YOUR_PASSWORD"
}
```

**Expect:** `403` `SUSPICIOUS_CLIENT` — Device ID required.

---

## Test C — App login blocked (fake browser client)

```http
POST /api/v7/client/login
Content-Type: application/json
X-Flow-Client: chrome/155.0.0.0
```

```json
{
  "username": "YOUR_TEST_USER",
  "password": "YOUR_PASSWORD",
  "deviceId": "test-device-id-00123456789"
}
```

**Expect:** `403` `SUSPICIOUS_CLIENT` — Official app client required.

---

## Test D — App login shape (needs real `clientPublicKey` from EXE)

```http
POST /api/v7/client/login
Content-Type: application/json
X-Flow-Client: windows-exe/7.0.0
```

```json
{
  "username": "YOUR_TEST_USER",
  "password": "YOUR_PASSWORD",
  "deviceId": "test-device-id-00123456789",
  "clientPublicKey": "<from-app>"
}
```

**Expect if creds OK:** `200` + `channel` + JWT.  
Activity Logs: `client_login` with `deviceId` / `client`.

Without `clientPublicKey`: `400` `CHANNEL_REQUIRED`.

---

## Test E — Old API version

```http
POST /api/v6/client/login
Content-Type: application/json
X-Flow-Client: windows-exe/6.0.0
```

```json
{
  "username": "YOUR_TEST_USER",
  "password": "YOUR_PASSWORD",
  "deviceId": "test-device-id-00123456789"
}
```

**Expect:** `410` + `FORCE_UPDATE`.

---

## Test F — Public cookie-version poll (nginx 429 noise)

```http
POST /api/public/extension/cookie-version?t=1791805162117
Content-Type: application/json
```

```json
{}
```

**Expect:** `200` or `429` if rate-limited. No auth. Normal app polling, not a login.

---

## curl one-liners

```bash
# Website OK
curl -s -X POST https://flowcreatorai.site/api/session/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"YOUR_TEST_USER\",\"password\":\"YOUR_PASSWORD\"}"

# App blocked (no device)
curl -s -X POST https://flowcreatorai.site/api/v7/client/login \
  -H "Content-Type: application/json" \
  -H "X-Flow-Client: windows-exe/7.0.0" \
  -d "{\"username\":\"YOUR_TEST_USER\",\"password\":\"YOUR_PASSWORD\"}"

# App shape (still needs clientPublicKey for full success)
curl -s -X POST https://flowcreatorai.site/api/v7/client/login \
  -H "Content-Type: application/json" \
  -H "X-Flow-Client: windows-exe/7.0.0" \
  -d "{\"username\":\"YOUR_TEST_USER\",\"password\":\"YOUR_PASSWORD\",\"deviceId\":\"test-device-id-00123456789\"}"
```

---

## What “secure” looks like

1. Postman/curl **without** official client + device → blocked on `/api/v7/client/login`
2. Same creds on `/api/session/login` → allowed (website)
3. Only official app gets channel + can MAC `extension-step`
4. Fake `mac` on extension-step → `BAD_MAC`
