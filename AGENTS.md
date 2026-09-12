# Agent notes — Google Flow Studio

## Superpowers
Always follow `.cursor/rules/superpowers.mdc`: skill-check first, systematic-debugging for failures, verification-before-completion before any “fixed” claim.

## Studio UI (Next shell)
- Route: `/dashboard/studio` (full-bleed; no SaaS sidebar).
- Markup: `src/components/studio/StudioShell.tsx` — keep DOM `id`s stable; `app.js` binds by `getElementById`.
- Logic (only edit here): `public/static/app.js` + `public/static/whisk.js`.
- Styles: `/static/style.css`, `/static/whisk.css` (loaded by the Studio page).
- Do **not** revive `public/**/index.html` or duplicate `app.js` copies. Old `/studio` and `*.html` paths redirect to `/dashboard/studio`.

## Generation (critical)
T2V/T2I with reCAPTCHA: **same-page CDP mint+POST** (existing labs/flow tab → else helper Chrome). Never stamp tokens onto Python HTTP. Needs `SID`/`HSID`/`APISID` + labs Bearer. See `.cursor/rules/google-flow-studio.mdc`. Reference `Google Flow v3` for payloads only — do not copy its HTTP stamp retry.

## agentmemory
Persistent memory for this project:

- Data dir: `%USERPROFILE%\.agentmemory-projects\google-flow`
- Start: `npx -y @agentmemory/agentmemory@latest --data-dir "%USERPROFILE%\.agentmemory-projects\google-flow"`
- REST: http://127.0.0.1:3111/agentmemory/* (remember, smart-search, livez)
- Viewer: http://127.0.0.1:3113
- MCP: `.cursor/mcp.json` → `npx -y @agentmemory/mcp` with `AGENTMEMORY_URL=http://127.0.0.1:3111`
- On Windows, pin `iii.exe` v0.11.2 under `%USERPROFILE%\.agentmemory\bin\iii.exe` (see https://github.com/iii-hq/iii/releases/tag/iii%2Fv0.11.2)

Prefer saving durable lessons (auth/cookie/project pitfalls) via agentmemory when the server is up. Reload Cursor MCP after changing `.cursor/mcp.json`.
