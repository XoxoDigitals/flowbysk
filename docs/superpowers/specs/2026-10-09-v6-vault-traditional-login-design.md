# Flow Browser v6 — vault + traditional login

## Summary

v6 restores **traditional Google credential login** (v4-style `extension-step` / fill), not cookie inject. Old clients (v2–v5) receive `410 FORCE_UPDATE`. The portable EXE embeds an **AES-256-GCM www vault**, keeps only a **DPAPI-wrapped session.bin**, and uses **ephemeral WebView2 profiles** under `%TEMP%\FlowBrowserV6` (wiped on close).

## Server

- Live: `/api/v6/client` (`server/routes/client-v6.js`)
- Dead: `/api/v2`…`/api/v5` → `FORCE_UPDATE`
- Branding `clientApiVersion`: `v6`

## Client host

1. **Embedded UI vault** — `www.vault` (magic `FBW6`) inside EXE; decrypt to hidden temp; wipe on exit  
2. **Session vault** — `session.bin` (magic `FBS6`, AES key + DPAPI wrap); auth token / server URL only  
3. **Runtime profiles** — `%TEMP%\FlowBrowserV6\{guid}\shell|flow`  
4. **No loose JS/HTML after quit** (Release)  
5. **App-generated secret** — never prompted; bound to Windows user via DPAPI  

## Auth mode

Traditional login (credentials JIT via `extension-step`), not cookie pack.
