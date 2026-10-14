# Activity Logs — login meanings

Admin → **Activity Logs**. Filter by **User** + **From/To** date, optionally **Search** for action names.

## Actions that matter for “did they finish login?”

| Action | When it is written | Meaning |
|---|---|---|
| `client_login` | Successful `/api/v7/client/login` or website user login via session | Password accepted; app/API session issued |
| `extension_login_start` | `/extension-start` | Google auto-login **started** |
| `extension_step` | `/extension-step` (email/password/otp) | Sealed credential pulled (not plaintext in logs) |
| `extension_login_finish` | `/extension-finish` | Google flow **ended** (`outcome`: success / cancelled / …) |

## How to read a suspicious user

Example times:

- `veovllanka105@gmail.com` — `10/12/2026, 6:35:07 AM`
- `g35890484@gmail.com` — `10/12/2026, 6:52:40 AM`

For each username:

1. Activity Logs → User = that email  
2. From/To = `2026-10-12`  
3. Look near that timestamp  

| What you see near that time | Verdict |
|---|---|
| `client_login` only | Signed into Flow API; Google not finished |
| `extension_login_start` only | Started Google; **not** completed |
| `start` then `finish` with success | **Login completed** |
| No rows | That UI time is not a successful logged event (or wrong day/timezone) |

Also compare **IP** and **country** on those rows across the two users.

## Nginx note

Nginx access logs show URL + Cloudflare edge IP + status — **not** the Gmail username.  
Username proof is only in Activity Logs / DB.

Login-related paths to grep:

```text
/api/session/login
/api/v7/client/login
/extension-start
/extension-step
/extension-finish
```

Cookie polling (`/api/public/extension/cookie-version` → often `429`) is normal client noise, not login completion.
