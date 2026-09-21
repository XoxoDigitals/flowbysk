# Flow Creator Ai (Browser branch)

Clean branch — **only** the new system. No Flowbysk studio, Python API, or BiB.

| Path | Role | Port |
|------|------|------|
| `dashboard/` | Next.js admin / user / reseller UI | 3100 |
| `server/` | Express + Prisma API (desktop exe) | 8000 |
| `client-webview2/` | Windows Flow Browser source | — |
| `client-android/` | Android client source | — |

**Domain:** https://flowcreatorai.site  
- nginx `/` → `127.0.0.1:3100`  
- nginx `/api/` + `/download/` → `127.0.0.1:8000`  

Keep server `.env` `DATABASE_URL` — never commit secrets.
