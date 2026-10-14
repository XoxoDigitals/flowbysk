# Release hygiene (v8 portable)

See also: [`client-webview2/tools/publish-portable-checklist.md`](../../client-webview2/tools/publish-portable-checklist.md)

## Must ship

1. **One EXE** named e.g. `Flow Browser 8.0.0.exe` — no duplicate bare `Flow Browser.exe`.
2. **No `.pdb`** beside the portable EXE (Release `DebugType=none` in csproj).
3. **SHA-256** stored on file upload (`server/downloads.js`) and shown on:
   - Admin → Settings → package card
   - User dashboard download section
4. **DevTools off** on Flow view (password leak fix).

## Optional

Authenticode sign with your `.pfx` when available (`signtool` — see checklist). Signing is prepared; shipping is not blocked without a cert.

## Version

- EXE / project version: **8.0.0**
- Client API: **`/api/v8/client`**
