# How the app makes `clientPublicKey`

**Short answer:** it is **unique every login** (ephemeral X25519). It is **not** the same as `deviceId`.

---

## What happens in the app

On each login (or `/channel-open`), the UI calls:

```js
const clientPublicKey = await window.FlowCredChannel.generateClientPublicKey();
```

That:

1. Creates a **new** X25519 keypair  
   - Android: WebCrypto `crypto.subtle.generateKey({ name: 'X25519' })`  
   - Windows: host bridge (`CredChannelHost` / NSec) when WebCrypto is missing
2. Keeps the **private** key only in memory on the device
3. Exports the **public** key as **base64url** and sends it as `clientPublicKey` in the login JSON

Server creates its own ephemeral keypair, returns:

```json
{
  "channel": {
    "channelId": "ch_xxx",
    "serverPublicKey": "<base64>",
    "expiresInSeconds": 3600
  }
}
```

Both sides run ECDH → derive AES key (`flow-cred-v1`) used to:

- seal email / password / OTP on `extension-step`
- HMAC `mac` + `ts` on each step request

Code: `client-webview2/FlowBrowser/www/scripts/cred-channel.js`  
Windows host: `CredChannelHost.GenerateClientPublicKey()` creates a new key every call.

---

## Same vs unique

| Field | Same every time? | Purpose |
|---|---|---|
| `deviceId` | **Yes** (stable per install / PC) | Which machine; attestation / bans |
| `X-Flow-Client` | Mostly same (`windows-exe/7.0.0`) | Prove official app |
| `clientPublicKey` | **No — new every login/channel** | Encrypt credentials for this session |
| `channelId` | New per channel | Bind sealed steps to this ECDH session |

---

## Why Postman cannot finish Google login

You cannot reuse yesterday’s `clientPublicKey`. Without the matching **private** key in that same app process you cannot:

- decrypt `extension-step` ciphertext
- forge a valid `mac`

Stealing a login request body (public key only) is not enough to pull Google credentials.

---

## Relation to Activity Logs

| Event | Needs `clientPublicKey`? |
|---|---|
| `client_login` | Yes on app path (to open channel) |
| `extension_login_start` | Needs live `channelId` from that ECDH |
| `extension_step` | Needs AES from that ECDH + MAC |
| `extension_login_finish` | Needs JWT + `attemptId` (app after Google done) |
