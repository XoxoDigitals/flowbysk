# Flow Browser (Edge WebView2)

In-app Microsoft Edge WebView2 host — not Electron. Google sees a real Edge profile.

## Run

- Double-click `Launch Flow Browser.bat` in the repo root, or
- `dotnet run -c Release` from `client-webview2/FlowBrowser`

Requires [.NET 8](https://dotnet.microsoft.com/download/dotnet/8.0) and the [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

## Layout

- `ShellView` — toolbar / login / overlays (`www/ui`)
- `FlowView` — Edge profile for `flow.google.com` + Google sign-in (`www/scripts/flow-inject.js`)

Profiles live under `%LocalAppData%\FlowBrowser\`.
