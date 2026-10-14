# Flow Browser API v7 docs

Base URL: `https://flowcreatorai.site`  
Live client API: **`/api/v7/client` only** (v2–v6 → `410 FORCE_UPDATE`)

| Doc | Contents |
|---|---|
| [login-flow.md](./login-flow.md) | Full app login: every step request body → response |
| [security-checks.md](./security-checks.md) | Device attestation, website vs app, manual reject tests |
| [client-public-key.md](./client-public-key.md) | How `clientPublicKey` is made (ephemeral X25519) |
| [activity-log-meanings.md](./activity-log-meanings.md) | What Activity Logs actions mean for “login completed” |

## Quick map

```
Website portal  →  POST /api/session/login     (no Device ID)
Official app    →  POST /api/v7/client/login   (Device ID + X-Flow-Client + clientPublicKey)
                →  extension-start / step / finish  (sealed Google credentials)
```
