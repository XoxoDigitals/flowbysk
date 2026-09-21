using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;

namespace FlowBrowser;

public partial class MainWindow : Window
{
    const double ChromeHeight = 80;
    AppConfig _config = AppConfig.Load();
    string _flowUserData = "";
    string _shellUserData = "";
    string _wwwRoot = "";
    string _flowInject = "";
    bool _shellReady;
    bool _flowReady;
    string _shellMode = "full";
    string? _flowCredEmail;
    string? _flowCredPassword;
    string? _flowCredTarget;
    int _autofillGeneration;
    long _lastAutofillKickMs;

    public MainWindow()
    {
        InitializeComponent();
        MouseLeftButtonDown += (_, e) =>
        {
            if (e.ButtonState == MouseButtonState.Pressed)
            {
                try { DragMove(); } catch { /* ignore */ }
            }
        };
        Loaded += async (_, _) => await InitAsync();
    }

    string ResolveWwwRoot()
    {
        var baseDir = AppContext.BaseDirectory;
        var candidates = new[]
        {
            Path.Combine(baseDir, "www"),
            Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "www")),
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "www")
        };
        foreach (var c in candidates)
        {
            var shell = Path.Combine(c, "ui", "app-shell.html");
            if (File.Exists(shell)) return c;
        }
        throw new DirectoryNotFoundException("www UI folder not found next to the executable.");
    }

    async Task InitAsync()
    {
        _wwwRoot = ResolveWwwRoot();
        // Strip UTF-8 BOM — WebView2 document-created scripts can fail oddly with BOM
        _flowInject = File.ReadAllText(Path.Combine(_wwwRoot, "scripts", "flow-inject.js")).TrimStart('\uFEFF');

        var dataRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FlowBrowser");
        Directory.CreateDirectory(dataRoot);
        _shellUserData = Path.Combine(dataRoot, "shell-profile");
        _flowUserData = Path.Combine(dataRoot, "flow-profile");
        Directory.CreateDirectory(_shellUserData);
        Directory.CreateDirectory(_flowUserData);

        var flowOpts = new CoreWebView2EnvironmentOptions(
            additionalBrowserArguments: "--remote-debugging-port=9223");
        var shellEnv = await CoreWebView2Environment.CreateAsync(userDataFolder: _shellUserData);
        var flowEnv = await CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder: _flowUserData,
            options: flowOpts);

        await ShellView.EnsureCoreWebView2Async(shellEnv);
        await FlowView.EnsureCoreWebView2Async(flowEnv);

        ConfigureShell();
        ConfigureFlow();

        _shellReady = true;
        _flowReady = true;

        SetShellMode("full");
        // http:// virtual host avoids mixed-content blocks when calling http://localhost API
        ShellView.CoreWebView2.Navigate("http://flowbrowser.local/ui/app-shell.html");
    }

    void ConfigureShell()
    {
        var core = ShellView.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        // Suppress native alert/confirm chrome (clipped in frameless window)
        core.ScriptDialogOpening += (_, e) =>
        {
            // Accept alerts so scripts don't hang; treat confirm as Cancel
            if (e.Kind == CoreWebView2ScriptDialogKind.Alert)
                e.Accept();
        };
        core.WebMessageReceived += Shell_WebMessageReceived;
        core.SetVirtualHostNameToFolderMapping(
            "flowbrowser.local",
            _wwwRoot,
            CoreWebView2HostResourceAccessKind.Allow);
    }

    void ConfigureFlow()
    {
        var core = FlowView.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = true;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;

        // Real Edge WebView2 — no Electron UA spoofing needed
        core.WebMessageReceived += Flow_WebMessageReceived;

        // Port of Electron webRequest.onCompleted — drives credit deduction
        core.WebResourceResponseReceived += (_, e) =>
        {
            try
            {
                var uri = e.Request?.Uri ?? "";
                if (string.IsNullOrWhiteSpace(uri)) return;
                var u = uri.ToLowerInvariant();
                var looksGen =
                    u.Contains("batchgenerate") ||
                    u.Contains("batch_generate") ||
                    u.Contains("generatevideo") ||
                    u.Contains("generateimage") ||
                    u.Contains("aisandbox") ||
                    (u.Contains("/operations/") &&
                     string.Equals(e.Request.Method, "GET", StringComparison.OrdinalIgnoreCase));
                if (!looksGen) return;

                var status = e.Response?.StatusCode ?? 0;
                if (status != 0 && status != 200) return;

                PostToFlow(new
                {
                    type = "toGuest",
                    channel = "flow:generation-network-completed",
                    data = new { url = uri, method = e.Request.Method }
                });
            }
            catch (Exception ex)
            {
                Debug.WriteLine("WebResourceResponseReceived: " + ex.Message);
            }
        };

        core.NavigationStarting += (_, e) =>
        {
            PostToShell(new
            {
                type = "flow-event",
                @event = "did-start-loading",
                url = e.Uri
            });
        };
        core.NavigationCompleted += (_, e) =>
        {
            var url = core.Source ?? "";
            // Ignore aborted/cancelled navigations (common when switching URLs or shell mode)
            if (!e.IsSuccess)
            {
                var status = e.WebErrorStatus;
                if (status == CoreWebView2WebErrorStatus.OperationCanceled ||
                    status == CoreWebView2WebErrorStatus.ConnectionAborted)
                {
                    return;
                }
                PostToShell(new
                {
                    type = "flow-event",
                    @event = "did-fail-load",
                    url,
                    errorCode = (int)status,
                    errorDescription = status.ToString()
                });
                return;
            }
            PostToShell(new { type = "flow-event", @event = "did-navigate", url });
            PostToShell(new { type = "flow-event", @event = "did-finish-load", url });
            PostToShell(new { type = "flow-event", @event = "dom-ready", url });
            _ = TryHostGoogleAutofillAsync(url);
        };
        core.HistoryChanged += (_, _) =>
        {
            var url = core.Source ?? "";
            PostToShell(new { type = "flow-event", @event = "did-navigate-in-page", url });
            PostToShell(new { type = "flow-event", @event = "page-title-updated", url });
            _ = TryHostGoogleAutofillAsync(url);
        };
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            if (!string.IsNullOrWhiteSpace(e.Uri) && e.Uri.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            {
                core.Navigate(e.Uri);
            }
        };
        core.DownloadStarting += (_, e) =>
        {
            var name = e.ResultFilePath;
            try { name = Path.GetFileName(e.ResultFilePath); } catch { /* ignore */ }
            PostToShell(new
            {
                type = "download",
                phase = "started",
                data = new { filename = name, totalBytes = 0 }
            });
            e.DownloadOperation.StateChanged += (op, __) =>
            {
                var d = (CoreWebView2DownloadOperation)op!;
                if (d.State == CoreWebView2DownloadState.Completed)
                {
                    PostToShell(new
                    {
                        type = "download",
                        phase = "completed",
                        data = new { filename = Path.GetFileName(d.ResultFilePath), savePath = d.ResultFilePath }
                    });
                }
                else if (d.State == CoreWebView2DownloadState.Interrupted)
                {
                    PostToShell(new
                    {
                        type = "download",
                        phase = "failed",
                        data = new { filename = Path.GetFileName(d.ResultFilePath), state = "interrupted" }
                    });
                }
            };
        };

        _ = core.AddScriptToExecuteOnDocumentCreatedAsync(_flowInject);
    }

    void SetShellMode(string mode)
    {
        _shellMode = mode;
        Dispatcher.Invoke(() =>
        {
            if (mode == "full")
            {
                // WebView2 uses native HWNDs — ZIndex cannot cover Flow. Hide it while overlays show.
                FlowView.Visibility = Visibility.Collapsed;
                ShellView.Height = double.NaN;
                ShellView.VerticalAlignment = VerticalAlignment.Stretch;
                ShellView.Margin = new Thickness(0);
                Panel.SetZIndex(ShellView, 2);
                Panel.SetZIndex(FlowView, 1);
            }
            else
            {
                FlowView.Visibility = Visibility.Visible;
                ShellView.Height = ChromeHeight;
                ShellView.VerticalAlignment = VerticalAlignment.Top;
                ShellView.Margin = new Thickness(0);
                FlowView.Margin = new Thickness(0, ChromeHeight, 0, 0);
                Panel.SetZIndex(ShellView, 2);
                Panel.SetZIndex(FlowView, 1);
            }
        });
    }

    void PostToShell(object payload)
    {
        if (!_shellReady || ShellView.CoreWebView2 == null) return;
        try
        {
            var json = JsonSerializer.Serialize(payload);
            Dispatcher.Invoke(() => ShellView.CoreWebView2.PostWebMessageAsJson(json));
        }
        catch (Exception ex)
        {
            Debug.WriteLine("PostToShell failed: " + ex.Message);
        }
    }

    void PostToFlow(object payload)
    {
        if (!_flowReady || FlowView.CoreWebView2 == null) return;
        try
        {
            var json = JsonSerializer.Serialize(payload);
            Dispatcher.Invoke(() => FlowView.CoreWebView2.PostWebMessageAsJson(json));
        }
        catch (Exception ex)
        {
            Debug.WriteLine("PostToFlow failed: " + ex.Message);
        }
    }

    static string JsString(string? value)
    {
        if (value == null) return "''";
        return "'" + value
            .Replace("\\", "\\\\")
            .Replace("'", "\\'")
            .Replace("\r", "\\r")
            .Replace("\n", "\\n")
            .Replace("\u2028", "\\u2028")
            .Replace("\u2029", "\\u2029") + "'";
    }

    async Task TryHostGoogleAutofillAsync(string? url)
    {
        try
        {
            if (FlowView.CoreWebView2 == null) return;
            if (string.IsNullOrWhiteSpace(_flowCredEmail)) return;
            var u = url ?? FlowView.CoreWebView2.Source ?? "";
            if (!u.Contains("accounts.google.com", StringComparison.OrdinalIgnoreCase)) return;

            // Debounce — HistoryChanged fires often on Google SPA and was spawning fill loops
            var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (nowMs - _lastAutofillKickMs < 1200) return;
            _lastAutofillKickMs = nowMs;

            await InjectGoogleAutofillOnceAsync();
            var gen = Interlocked.Increment(ref _autofillGeneration);
            _ = AutofillWithRetriesAsync(gen);
        }
        catch (Exception ex)
        {
            Debug.WriteLine("TryHostGoogleAutofill: " + ex.Message);
        }
    }

    async Task AutofillWithRetriesAsync(int generation)
    {
        try
        {
            // Fewer retries — password step must not be hammered
            foreach (var delay in new[] { 900, 2200 })
            {
                await Task.Delay(delay);
                if (generation != _autofillGeneration) return;
                await InjectGoogleAutofillOnceAsync();
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine("Autofill retry: " + ex.Message);
        }
    }

    async Task InjectGoogleAutofillOnceAsync()
    {
        if (FlowView.CoreWebView2 == null) return;
        if (string.IsNullOrWhiteSpace(_flowCredEmail)) return;
        var src = FlowView.CoreWebView2.Source ?? "";
        if (!src.Contains("accounts.google.com", StringComparison.OrdinalIgnoreCase)) return;
        var email = JsString(_flowCredEmail);
        var password = JsString(_flowCredPassword ?? "");
        // Once-per-step autofill — never re-click Next after a successful submit on this path
        var code = $@"
(() => {{
  const email = {email};
  const password = {password};
  if (!email) return {{ ok:false, reason:'no-email' }};
  window.__flowHostCreds = {{ email, password }};
  // Do NOT call __flowApplyCreds here — that reset inject state and caused password loops

  const st = window.__flowHostAuto = window.__flowHostAuto || {{}};
  const path = location.pathname || '';
  const stepKey = path.split('/').slice(0, 5).join('/');

  const visible = (el) => {{
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  }};
  const fill = (el, val) => {{
    if (!el || !val) return false;
    if ((el.value || '') === val || (el.value || '').toLowerCase() === String(val).toLowerCase()) return true;
    try {{ el.removeAttribute('readonly'); el.readOnly = false; }} catch (e) {{}}
    try {{ el.focus(); }} catch (e) {{}}
    const proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    const setter = desc && desc.set;
    if (setter) setter.call(el, val); else el.value = val;
    try {{ el.dispatchEvent(new InputEvent('input', {{ bubbles:true, cancelable:true, data:val, inputType:'insertText' }})); }}
    catch (e) {{ el.dispatchEvent(new Event('input', {{ bubbles:true }})); }}
    el.dispatchEvent(new Event('change', {{ bubbles:true }}));
    return (el.value || '') === val || (el.value || '').toLowerCase() === String(val).toLowerCase();
  }};
  const clickNext = () => {{
    const next = document.querySelector('#identifierNext button, #identifierNext, #passwordNext button, #passwordNext') ||
      Array.from(document.querySelectorAll('button')).find(b => /^\\s*next\\s*$/i.test((b.innerText || b.textContent || '')));
    if (!next || !visible(next)) return false;
    try {{ next.removeAttribute('disabled'); next.setAttribute('aria-disabled','false'); }} catch (e) {{}}
    try {{ next.click(); }} catch (e) {{}}
    return true;
  }};

  try {{
    const onPwd = /\\/challenge\\/pwd/i.test(path) || !!document.querySelector('input[type=""password""]');
    if (!document.getElementById('__flow_host_ol__') && !st.overlayDismissed && !onPwd) {{
      const s = document.createElement('style');
      s.id = '__flow_host_ol_style__';
      s.textContent = '#__flow_host_ol__{{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(2,6,23,.82);color:#f8fafc;font-family:Segoe UI,system-ui,sans-serif;cursor:pointer}}#__flow_host_ol__ .c{{text-align:center;pointer-events:none}}#__flow_host_ol__ h3{{margin:0 0 8px;font-size:20px}}#__flow_host_ol__ p{{margin:0;color:#94a3b8;font-size:14px}}';
      (document.head||document.documentElement).appendChild(s);
      const ol = document.createElement('div');
      ol.id = '__flow_host_ol__';
      ol.innerHTML = '<div class=""c""><h3>Signing you in…</h3><p>Automatic Google login · click anywhere to watch</p></div>';
      ol.addEventListener('click', () => {{ st.overlayDismissed = true; ol.remove(); }}, {{ once:true }});
      (document.body||document.documentElement).appendChild(ol);
    }}
    // Hide overlay on password so user can see the field / captcha
    if (onPwd) {{
      const ol = document.getElementById('__flow_host_ol__');
      if (ol) ol.remove();
    }}
  }} catch (e) {{}}

  const pwd = Array.from(document.querySelectorAll('input[name=""Passwd""], input[type=""password""], input[autocomplete*=""current-password""]')).find(el => visible(el));
  if (pwd && password) {{
    const pwdKey = 'pwd:' + stepKey;
    if (st[pwdKey] === 'submitted') return {{ ok:true, step:'password-done' }};
    const already = (pwd.value || '') === password;
    const ok = already || fill(pwd, password);
    if (ok && st[pwdKey] !== 'filled') {{
      st[pwdKey] = 'filled';
      setTimeout(() => {{
        if (st[pwdKey] === 'submitted') return;
        if (clickNext()) st[pwdKey] = 'submitted';
      }}, 500);
    }}
    return {{ ok, step:'password', already }};
  }}

  const em = document.querySelector('input#identifierId, input[type=""email""], input[name=""identifier""], input[autocomplete=""username""]');
  if (em && visible(em) && email) {{
    const emKey = 'email:' + stepKey;
    if (st[emKey] === 'submitted') return {{ ok:true, step:'email-done' }};
    const already = (em.value || '').toLowerCase() === email.toLowerCase();
    const ok = already || fill(em, email);
    if (ok && st[emKey] !== 'filled' && st[emKey] !== 'submitted') {{
      st[emKey] = 'filled';
      setTimeout(() => {{
        if (st[emKey] === 'submitted') return;
        if (clickNext()) st[emKey] = 'submitted';
      }}, 1100);
    }}
    return {{ ok, step:'email', already }};
  }}
  return {{ ok:false, reason:'no-field', path }};
}})()";
        try
        {
            var result = await FlowView.CoreWebView2.ExecuteScriptAsync(code);
            Debug.WriteLine("[HostAutofill] " + result);
        }
        catch (Exception ex)
        {
            Debug.WriteLine("[HostAutofill] failed: " + ex.Message);
        }
    }

    static JsonElement ParseMessage(CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var s = e.TryGetWebMessageAsString();
            if (!string.IsNullOrWhiteSpace(s))
                return JsonDocument.Parse(s).RootElement.Clone();
        }
        catch { /* fall through */ }

        try
        {
            var el = JsonSerializer.Deserialize<JsonElement>(e.WebMessageAsJson);
            if (el.ValueKind == JsonValueKind.String)
                return JsonDocument.Parse(el.GetString()!).RootElement.Clone();
            return el.Clone();
        }
        catch
        {
            return default;
        }
    }

    async void Shell_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        var root = ParseMessage(e);
        if (root.ValueKind != JsonValueKind.Object) return;

        if (!root.TryGetProperty("type", out var typeEl)) return;
        var type = typeEl.GetString();

        if (type == "cmd")
        {
            await HandleShellCmd(root);
            return;
        }

        if (type == "invoke")
        {
            var id = root.GetProperty("id").GetInt32();
            var cmd = root.GetProperty("cmd").GetString() ?? "";
            JsonElement payload = default;
            if (root.TryGetProperty("payload", out var p)) payload = p;
            try
            {
                var result = await HandleInvoke(cmd, payload);
                PostToShell(new { type = "invoke-result", id, result });
            }
            catch (Exception ex)
            {
                PostToShell(new { type = "invoke-result", id, error = ex.Message });
            }
        }
    }

    void Flow_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        var root = ParseMessage(e);
        if (root.ValueKind != JsonValueKind.Object) return;

        if (!root.TryGetProperty("type", out var typeEl) || typeEl.GetString() != "toHost") return;
        var channel = root.TryGetProperty("channel", out var ch) ? ch.GetString() : "";
        object? data = null;
        if (root.TryGetProperty("data", out var d) && d.ValueKind != JsonValueKind.Null && d.ValueKind != JsonValueKind.Undefined)
            data = JsonSerializer.Deserialize<object>(d.GetRawText());

        // Trusted CDP mouse click — Glif ignores page-level synthetic clicks for 2FA rows
        if (string.Equals(channel, "cdp-click", StringComparison.OrdinalIgnoreCase) &&
            root.TryGetProperty("data", out var clickData) &&
            clickData.ValueKind == JsonValueKind.Object)
        {
            double x = clickData.TryGetProperty("x", out var xv) ? xv.GetDouble() : 0;
            double y = clickData.TryGetProperty("y", out var yv) ? yv.GetDouble() : 0;
            _ = CdpMouseClickAsync(x, y);
        }

        PostToShell(new
        {
            type = "flow-event",
            @event = "ipc-message",
            channel,
            args = data == null ? Array.Empty<object>() : new[] { data }
        });
    }

    async Task FillTotpAsync(string? otp)
    {
        try
        {
            if (FlowView.CoreWebView2 == null) return;
            if (string.IsNullOrWhiteSpace(otp)) return;
            var src = FlowView.CoreWebView2.Source ?? "";
            if (!src.Contains("challenge/totp", StringComparison.OrdinalIgnoreCase)) return;
            var code = JsString(otp);
            var script = $@"(() => {{
  const otp = {code};
  const visible = (el) => {{
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }};
  const el = document.querySelector('input[name=""totpPin""], input#totpPin') ||
    Array.from(document.querySelectorAll('input')).find(i => {{
      if (!visible(i) || i.type === 'hidden' || i.type === 'checkbox') return false;
      const b = ((i.getAttribute('aria-label')||'') + ' ' + (i.placeholder||'') + ' ' + (i.name||'')).toLowerCase();
      return /code|totp|otp/.test(b);
    }});
  if (!el) return 'no-input';
  if ((el.value || '') === otp) return 'already';
  const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  const setter = desc && desc.set;
  try {{ el.focus(); }} catch (e) {{}}
  if (setter) setter.call(el, otp); else el.value = otp;
  el.dispatchEvent(new Event('input', {{ bubbles: true }}));
  el.dispatchEvent(new Event('change', {{ bubbles: true }}));
  setTimeout(() => {{
    const btn = document.querySelector('#totpNext button, #totpNext') ||
      Array.from(document.querySelectorAll('button')).find(b => /^\\s*next\\s*$/i.test((b.innerText || '').trim()));
    if (btn) {{ try {{ btn.click(); }} catch (e) {{}} }}
  }}, 500);
  return 'filled:' + (el.value || '').length;
}})()";
            var result = await FlowView.CoreWebView2.ExecuteScriptAsync(script);
            Debug.WriteLine("[FillTotp] " + result);
        }
        catch (Exception ex)
        {
            Debug.WriteLine("FillTotp: " + ex.Message);
        }
    }
    async Task CdpMouseClickAsync(double x, double y)
    {
        try
        {
            if (FlowView.CoreWebView2 == null) return;
            if (x <= 0 || y <= 0) return;
            var pressed = $"{{\"type\":\"mousePressed\",\"x\":{(int)Math.Round(x)},\"y\":{(int)Math.Round(y)},\"button\":\"left\",\"clickCount\":1}}";
            var released = $"{{\"type\":\"mouseReleased\",\"x\":{(int)Math.Round(x)},\"y\":{(int)Math.Round(y)},\"button\":\"left\",\"clickCount\":1}}";
            await FlowView.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", pressed);
            await Task.Delay(40);
            await FlowView.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", released);
            Debug.WriteLine($"[CdpClick] {x},{y}");
        }
        catch (Exception ex)
        {
            Debug.WriteLine("CdpMouseClick: " + ex.Message);
        }
    }

    async Task HandleShellCmd(JsonElement root)
    {
        var cmd = root.TryGetProperty("cmd", out var c) ? c.GetString() : "";
        switch (cmd)
        {
            case "navigate":
            {
                var url = root.TryGetProperty("url", out var u) ? u.GetString() : "about:blank";
                if (string.IsNullOrWhiteSpace(url) || url.Contains("demo-flow") || url.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
                    url = "https://flow.google.com/";
                FlowView.CoreWebView2?.Navigate(url);
                break;
            }
            case "reload":
            {
                var ignore = root.TryGetProperty("ignoreCache", out var ic) && ic.GetBoolean();
                if (FlowView.CoreWebView2 != null)
                {
                    if (ignore)
                        _ = FlowView.CoreWebView2.CallDevToolsProtocolMethodAsync("Page.reload", "{\"ignoreCache\":true}");
                    else
                        FlowView.CoreWebView2.Reload();
                }
                break;
            }
            case "stop":
                FlowView.CoreWebView2?.Stop();
                break;
            case "zoom":
            {
                if (root.TryGetProperty("factor", out var f) && FlowView.CoreWebView2 != null)
                    FlowView.ZoomFactor = f.GetDouble();
                break;
            }
            case "sendToFlow":
            {
                var channel = root.TryGetProperty("channel", out var ch) ? ch.GetString() : "";
                object? data = null;
                if (root.TryGetProperty("data", out var d))
                    data = JsonSerializer.Deserialize<object>(d.GetRawText());
                PostToFlow(new { type = "toGuest", channel, data });
                // Also keep host-side creds + force autofill when credentials are applied
                if (string.Equals(channel, "apply-credentials", StringComparison.OrdinalIgnoreCase) &&
                    root.TryGetProperty("data", out var credData) &&
                    credData.ValueKind == JsonValueKind.Object)
                {
                    if (credData.TryGetProperty("email", out var em))
                        _flowCredEmail = em.GetString();
                    if (credData.TryGetProperty("password", out var pw))
                        _flowCredPassword = pw.GetString();
                    if (credData.TryGetProperty("targetUrl", out var tu))
                        _flowCredTarget = tu.GetString();
                    var url = FlowView.CoreWebView2?.Source ?? "";
                    _ = TryHostGoogleAutofillAsync(url);
                }
                break;
            }
            case "setFlowCreds":
            {
                if (root.TryGetProperty("email", out var em2))
                    _flowCredEmail = em2.GetString();
                if (root.TryGetProperty("password", out var pw2))
                    _flowCredPassword = pw2.GetString();
                if (root.TryGetProperty("targetUrl", out var tu2))
                    _flowCredTarget = tu2.GetString();
                var url2 = FlowView.CoreWebView2?.Source ?? "";
                _ = TryHostGoogleAutofillAsync(url2);
                break;
            }
            case "cdpClick":
            {
                double x = root.TryGetProperty("x", out var xv) ? xv.GetDouble() : 0;
                double y = root.TryGetProperty("y", out var yv) ? yv.GetDouble() : 0;
                _ = CdpMouseClickAsync(x, y);
                break;
            }
            case "fillOtp":
            {
                var otp = root.TryGetProperty("otp", out var otpEl) ? otpEl.GetString() : "";
                _ = FillTotpAsync(otp);
                break;
            }
            case "shellMode":
            {
                var mode = root.TryGetProperty("mode", out var m) ? m.GetString() : "chrome";
                SetShellMode(mode == "full" ? "full" : "chrome");
                break;
            }
        }
        await Task.CompletedTask;
    }

    async Task<object?> HandleInvoke(string cmd, JsonElement payload)
    {
        switch (cmd)
        {
            case "getConfig":
                return JsonSerializer.Deserialize<object>(_config.ToJson());
            case "saveServerUrl":
            {
                var url = payload.TryGetProperty("url", out var u) ? u.GetString() : null;
                if (!string.IsNullOrWhiteSpace(url))
                {
                    _config.ServerUrl = url!;
                    _config.Save();
                }
                return new { success = true };
            }
            case "saveSession":
            {
                if (payload.TryGetProperty("token", out var t))
                    _config.AuthToken = t.GetString();
                if (payload.TryGetProperty("user", out var user))
                    _config.User = user.Clone();
                if (payload.TryGetProperty("activeServer", out var server))
                    _config.ActiveServer = server.Clone();
                _config.Save();
                return new { success = true };
            }
            case "clearSession":
                _config.AuthToken = null;
                _config.User = null;
                _config.ActiveServer = null;
                _config.Save();
                return new { success = true };
            case "clearPartitionSession":
                await ClearFlowSessionAsync();
                return new { success = true };
            case "minimize":
                WindowState = WindowState.Minimized;
                return new { success = true };
            case "maximize":
                WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
                return new { success = true };
            case "close":
                Close();
                return new { success = true };
            case "showInFolder":
            {
                var path = payload.TryGetProperty("filePath", out var fp) ? fp.GetString() : null;
                if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "explorer.exe",
                        Arguments = "/select,\"" + path + "\"",
                        UseShellExecute = true
                    });
                }
                return new { success = true };
            }
            case "executeFlow":
            {
                var code = payload.TryGetProperty("code", out var c) ? c.GetString() : "null";
                if (FlowView.CoreWebView2 == null) return null;
                var result = await FlowView.CoreWebView2.ExecuteScriptAsync(code ?? "null");
                try { return JsonSerializer.Deserialize<object>(result); }
                catch { return result; }
            }
            default:
                throw new InvalidOperationException("Unknown command: " + cmd);
        }
    }

    async Task ClearFlowSessionAsync()
    {
        if (FlowView.CoreWebView2 == null) return;
        try
        {
            FlowView.CoreWebView2.Stop();
            FlowView.CoreWebView2.Navigate("about:blank");
            await FlowView.CoreWebView2.Profile.ClearBrowsingDataAsync(
                CoreWebView2BrowsingDataKinds.AllProfile);
        }
        catch (Exception ex)
        {
            Debug.WriteLine("ClearFlowSession: " + ex.Message);
            // Fallback: wipe cookies for Google hosts
            try
            {
                foreach (var host in new[] { "https://accounts.google.com", "https://flow.google.com", "https://www.google.com" })
                {
                    var cookies = await FlowView.CoreWebView2.CookieManager.GetCookiesAsync(host);
                    foreach (var cookie in cookies)
                        FlowView.CoreWebView2.CookieManager.DeleteCookie(cookie);
                }
            }
            catch { /* ignore */ }
        }
    }
}
