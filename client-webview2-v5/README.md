# Flow Browser host notes (v5 cookie injection)

This folder documents the **v5** portable build. It does **not** replace `client-webview2/`.

## What changed in the shared host project

Additive files/wiring live in `client-webview2/FlowBrowser/`:

- `CookieInjectHost.cs` — `injectCookies` + SHA-256 verify + ephemeral profile helper
- `MainWindow.xaml.cs` — `injectCookies` invoke, Closing wipe, `FLOW_V5_EPHEMERAL=1` temp Flow profile

v4 behavior is unchanged unless the shell calls `injectCookies` (only `dist-portable-v5` does).

## Build a v5 portable EXE

1. Sync UI assets from the v5 tree:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\sync-www-from-dist-v5.ps1"
```

2. Prefer ephemeral Flow profile (cookies die with the process):

```powershell
$env:FLOW_V5_EPHEMERAL = "1"
dotnet build "..\client-webview2\FlowBrowser\FlowBrowser.csproj" -c Release
```

3. Point the app at your server; client API is pinned to `/api/v5/client` inside `dist-portable-v5`.

## Wipe policy

| Event | Action |
|-------|--------|
| App close | `ClearFlowSessionAsync` + delete ephemeral profile if enabled |
| Logout / force wipe | Shell clears RAM pack + `clearPartitionSession` |
| Failed inject | Host clears partial cookies before returning error |

## Do not

- Re-enable remote debugging ports in Release
- Call `flushCookies` from the v5 shell (disabled in `dist-portable-v5`)
