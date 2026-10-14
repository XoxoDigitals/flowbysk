# Flow Browser API v8 docs

Base URL: `https://flowcreatorai.site`  
Live client API: **`/api/v8/client` only** (v2–v7 → `410 FORCE_UPDATE`)

| Doc | Contents |
|---|---|
| [login-flow.md](./login-flow.md) | Full app login: every step request body → response |
| [security-and-lock.md](./security-and-lock.md) | Device attestation, 60‑minute Google session lock, vault non-secret |
| [release-hygiene.md](./release-hygiene.md) | DevTools off, SHA-256 downloads, no PDB / duplicate EXE |

## Quick map

```
Website portal  →  POST /api/session/login     (no Device ID)
Official app    →  POST /api/v8/client/login   (Device ID + X-Flow-Client + clientPublicKey)
                →  extension-start / step / finish
After success   →  60m lock on switch-server, request-server-change, extension-start
```
