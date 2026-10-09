# Flow Browser auth: v4 vs v5

| | **v4** (current production) | **v5** (cookie-only) |
|--|--|--|
| Client API | `/api/v4/client` | `/api/v5/client` |
| Portable UI | `dist-portable/` | `dist-portable-v5/` |
| Google auth | Email / password / TOTP via `extension-step` | Admin cookie JSON → inject + SHA-256 verify |
| Admin | Email, password, TOTP fields | Same + **v5 Cookie Export** panel (sorted expiry table) |
| Client storage | Cookies persist in WebView2 profile | Payload in **RAM only**; wipe on close / logout; optional `FLOW_V5_EPHEMERAL=1` |
| Host commands | `clearPartitionSession`, field fill | + `injectCookies` (`CookieInjectHost.cs`) |

## Cutover

1. Upload cookie JSON per shared account in Admin → Shared Servers.
2. Ship `dist-portable-v5` (+ host with `CookieInjectHost`).
3. Keep `/api/v4/client` live until all clients migrate.
4. Optionally return `FORCE_UPDATE` from v4 later.

## Security notes

- Cookie values are sealed at rest (`sealForStorage`).
- Admin meta endpoints return hashes + expiry only, never values.
- `cookie_fetch` audit logs never include cookie values.
- Release builds must not expose CDP debugging ports.
