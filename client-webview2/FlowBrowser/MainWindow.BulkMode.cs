using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace FlowBrowser;

public partial class MainWindow
{
    const double BulkPanelWidth = 440;
    const string VeoSidePanelUrl = "https://app.flowbrowser.localhost/extensions/veo-auto/src/ui/side-panel/index.html";
    const string VeoWorkflowUrl = "https://app.flowbrowser.localhost/extensions/veo-auto/src/ui/workflow/index.html";

    bool _bulkPanelOpen;
    bool _bulkReady;
    bool _bulkInitializing;
    CoreWebView2Environment? _shellEnv;
    CoreWebView2Environment? _flowEnv;
    string _veoContentBundle = "";
    JsonElement? _veoFallbackConfig;
    JsonElement? _veoLiveConfig;
    long _veoConfigFetchedAtMs;

    Window? _workflowWindow;
    WebView2? _workflowWebView;
    bool _workflowReady;

    string _veoDownloadFolder = "";
    string _veoDownloadPrefix = "";
    bool _veoAutoChangeFileName = true;
    double _veoMouseX = 520;
    double _veoMouseY = 420;
    readonly Random _veoRng = new();
    static readonly HttpClient _veoHttp = new() { Timeout = TimeSpan.FromSeconds(90) };

    static bool IsGoogleFlowAppUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return false;
        try
        {
            var host = new Uri(url).Host.ToLowerInvariant();
            return host == "flow.google.com"
                   || host.EndsWith(".flow.google.com")
                   || host == "labs.google"
                   || host.EndsWith(".labs.google");
        }
        catch
        {
            var u = url.ToLowerInvariant();
            return u.Contains("flow.google.com") || u.Contains("labs.google");
        }
    }

    bool IsCurrentPageGoogleFlow
    {
        get
        {
            var src = FlowView.CoreWebView2?.Source;
            if (IsGoogleFlowAppUrl(src)) return true;
            if ((string.IsNullOrWhiteSpace(src) || IsAboutBlank(src)) && IsGoogleFlowAppUrl(_flowCredTarget))
                return true;
            return false;
        }
    }

    System.Windows.Threading.DispatcherTimer? _bulkPinTimer;

    double RightBulkMargin => 0;

    void PinBulkViewAboveFlowView()
    {
        if (!_bulkPanelOpen || _shellMode == "full" || !IsCurrentPageGoogleFlow) return;
        if (_authUiMode == AuthUiCover) return;
        try
        {
            if (BulkView.Handle != IntPtr.Zero)
            {
                SetWindowPos(BulkView.Handle, HwndaTop, 0, 0, 0, 0, SwpNomove | SwpNosize | SwpNoactivate);
            }
        }
        catch { /* ignore */ }
    }

    void EnsureBulkPinTimer(bool enable)
    {
        if (!enable)
        {
            _bulkPinTimer?.Stop();
            return;
        }
        if (_bulkPinTimer == null)
        {
            _bulkPinTimer = new System.Windows.Threading.DispatcherTimer
            {
                Interval = TimeSpan.FromMilliseconds(120)
            };
            _bulkPinTimer.Tick += (_, _) =>
            {
                if (!_bulkPanelOpen || _shellMode == "full" || !IsCurrentPageGoogleFlow)
                {
                    _bulkPinTimer?.Stop();
                    return;
                }
                PinBulkViewAboveFlowView();
            };
        }
        if (!_bulkPinTimer.IsEnabled)
        {
            _bulkPinTimer.Start();
        }
    }

    void CloseBulkPanelIfOpen()
    {
        if (!_bulkPanelOpen) return;
        _bulkPanelOpen = false;
        Dispatcher.Invoke(() =>
        {
            EnsureBulkPinTimer(false);
            BulkView.Visibility = Visibility.Collapsed;
            if (_shellMode != "full")
            {
                FlowView.Margin = new Thickness(0, _chromeHeight, 0, 0);
            }
            SyncOverlayMargins();
            SyncAuthCoverBounds();
            PostToShell(new { type = "bulk-panel-state", open = false });
        });
    }

    void LoadVeoContentBundle()
    {
        try
        {
            var embeddedBundle = WwwExtractor.ReadEmbeddedText("scripts/veo-content-bundle.js")
                ?? WwwExtractor.ReadEmbeddedText("extensions/veo-auto/veo-content-bundle.js");
            if (!string.IsNullOrWhiteSpace(embeddedBundle))
            {
                _veoContentBundle = embeddedBundle;
            }
            else
            {
                var bundlePath = Path.Combine(_wwwRoot, "scripts", "veo-content-bundle.js");
                if (!File.Exists(bundlePath))
                    bundlePath = Path.Combine(_wwwRoot, "extensions", "veo-auto", "veo-content-bundle.js");
                if (File.Exists(bundlePath))
                    _veoContentBundle = File.ReadAllText(bundlePath).TrimStart('\uFEFF');
            }

            var embeddedFb = WwwExtractor.ReadEmbeddedText("extensions/veo-auto/remoteConfig.fallback.json");
            if (!string.IsNullOrWhiteSpace(embeddedFb))
            {
                _veoFallbackConfig = JsonDocument.Parse(embeddedFb).RootElement.Clone();
            }
            else
            {
                var fbPath = Path.Combine(_wwwRoot, "extensions", "veo-auto", "remoteConfig.fallback.json");
                if (File.Exists(fbPath))
                {
                    var raw = File.ReadAllText(fbPath).TrimStart('\uFEFF');
                    _veoFallbackConfig = JsonDocument.Parse(raw).RootElement.Clone();
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine("[BulkMode] LoadVeoContentBundle error: " + ex.Message);
        }
    }

    async Task InitBulkViewAsync(CoreWebView2Environment shellEnv)
    {
        if (_bulkReady || _bulkInitializing) return;
        _bulkInitializing = true;
        try
        {
            _shellEnv = shellEnv;
            await BulkView.EnsureCoreWebView2Async(shellEnv);
            ConfigureBulkView(BulkView.CoreWebView2);
            _bulkReady = true;
            BulkView.CoreWebView2.Navigate(VeoSidePanelUrl);
        }
        catch (Exception ex)
        {
            Debug.WriteLine("[BulkMode] InitBulkViewAsync error: " + ex.Message);
        }
        finally
        {
            _bulkInitializing = false;
        }
    }

    void ConfigureBulkView(CoreWebView2 core)
    {
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        ApplyChromeUserAgent(core);

        core.SetVirtualHostNameToFolderMapping(
            "app.flowbrowser.localhost",
            _wwwRoot,
            CoreWebView2HostResourceAccessKind.Allow);
        core.SetVirtualHostNameToFolderMapping(
            "flowbrowser.local",
            _wwwRoot,
            CoreWebView2HostResourceAccessKind.Allow);

        core.WebMessageReceived += BulkOrWorkflow_WebMessageReceived;
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            var uri = e.Uri ?? "";
            if (uri.Contains("workflow/index.html", StringComparison.OrdinalIgnoreCase))
            {
                Dispatcher.Invoke(OpenOrFocusWorkflowWindow);
            }
            else if (IsFlowWorkspaceUrl(uri))
            {
                _ = NavigateFlowSafeAsync(uri);
            }
        };
    }

    async Task EnsureVeoContentBundleOnFlowAsync()
    {
        var flowCore = FlowView.CoreWebView2;
        if (flowCore == null || string.IsNullOrWhiteSpace(_veoContentBundle)) return;
        try
        {
            var curUrl = flowCore.Source ?? "";
            if (IsGoogleFlowAppUrl(curUrl))
            {
                await flowCore.ExecuteScriptAsync(_veoContentBundle);
                await flowCore.ExecuteScriptAsync("try { if (typeof window.__veoStartModules === 'function') window.__veoStartModules(); } catch(e) {}");
            }
        }
        catch { /* ignore */ }
    }

    void SyncBulkLayout()
    {
        if (_shellMode == "full" || !IsCurrentPageGoogleFlow)
        {
            EnsureBulkPinTimer(false);
            BulkView.Visibility = Visibility.Collapsed;
            if (_shellMode != "full")
            {
                FlowView.Margin = new Thickness(0, _chromeHeight, 0, 0);
            }
            SyncOverlayMargins();
            SyncAuthCoverBounds();
            return;
        }

        BulkView.Margin = new Thickness(0, _chromeHeight, 0, 0);
        BulkView.Visibility = _bulkPanelOpen ? Visibility.Visible : Visibility.Collapsed;
        FlowView.Margin = new Thickness(0, _chromeHeight, 0, 0);
        if (_bulkPanelOpen)
        {
            PinBulkViewAboveFlowView();
            EnsureBulkPinTimer(true);
        }
        else
        {
            EnsureBulkPinTimer(false);
        }
        SyncOverlayMargins();
        SyncAuthCoverBounds();
    }

    void ToggleBulkPanel()
    {
        Dispatcher.Invoke(async () =>
        {
            if (!_bulkReady && _shellEnv != null)
            {
                await InitBulkViewAsync(_shellEnv);
            }
            _bulkPanelOpen = !_bulkPanelOpen;
            if (_bulkPanelOpen && _shellMode == "full")
            {
                SetShellMode("chrome");
            }
            SyncBulkLayout();
            PostToShell(new { type = "bulk-panel-state", open = _bulkPanelOpen });
            var curUrl = FlowView.CoreWebView2?.Source ?? "https://flow.google.com/";
            NotifyBulkFlowUrl(curUrl);
        });
    }

    void OpenOrFocusWorkflowWindow()
    {
        try
        {
            if (_workflowWindow != null && _workflowWindow.IsLoaded)
            {
                if (_workflowWindow.WindowState == WindowState.Minimized)
                    _workflowWindow.WindowState = WindowState.Normal;
                _workflowWindow.Activate();
                _workflowWindow.Focus();
                return;
            }

            if (_shellEnv == null) return;

            var wv = new WebView2
            {
                DefaultBackgroundColor = System.Drawing.Color.FromArgb(0xFF, 0x09, 0x0D, 0x16)
            };
            var win = new Window
            {
                Title = "Flow Creator Ai — Workflow Studio",
                Icon = Icon,
                Width = 1320,
                Height = 840,
                MinWidth = 960,
                MinHeight = 640,
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Owner = this,
                Background = new SolidColorBrush(Color.FromRgb(0x09, 0x0D, 0x16)),
                Content = wv
            };

            _workflowWindow = win;
            _workflowWebView = wv;
            _workflowReady = false;

            win.Closed += (_, _) =>
            {
                _workflowReady = false;
                _workflowWebView = null;
                _workflowWindow = null;
            };

            win.Loaded += async (_, _) =>
            {
                try
                {
                    await wv.EnsureCoreWebView2Async(_shellEnv);
                    ConfigureBulkView(wv.CoreWebView2);
                    _workflowReady = true;
                    _ = EnsureVeoContentBundleOnFlowAsync();
                    wv.CoreWebView2.Navigate(VeoWorkflowUrl);
                }
                catch (Exception ex)
                {
                    Debug.WriteLine("[BulkMode] Workflow window init failed: " + ex.Message);
                }
            };

            win.Show();
        }
        catch (Exception ex)
        {
            Debug.WriteLine("[BulkMode] OpenOrFocusWorkflowWindow error: " + ex.Message);
        }
    }

    void CloseWorkflowWindow()
    {
        try
        {
            _workflowWindow?.Close();
        }
        catch { /* ignore */ }
    }

    void PostToCore(CoreWebView2? core, object payload)
    {
        if (core == null) return;
        try
        {
            var json = JsonSerializer.Serialize(payload);
            Dispatcher.Invoke(() =>
            {
                try { core.PostWebMessageAsJson(json); } catch { /* ignore */ }
            });
        }
        catch { /* ignore */ }
    }

    void PostToBulkAndWorkflow(object payload)
    {
        try
        {
            var json = JsonSerializer.Serialize(payload);
            Dispatcher.Invoke(() =>
            {
                try
                {
                    if (_bulkReady && BulkView.CoreWebView2 != null)
                        BulkView.CoreWebView2.PostWebMessageAsJson(json);
                }
                catch { /* ignore */ }
                try
                {
                    if (_workflowReady && _workflowWebView?.CoreWebView2 != null)
                        _workflowWebView.CoreWebView2.PostWebMessageAsJson(json);
                }
                catch { /* ignore */ }
            });
        }
        catch { /* ignore */ }
    }

    void NotifyBulkFlowUrl(string? url)
    {
        if (!string.IsNullOrWhiteSpace(url) && !IsAboutBlank(url) && !IsGoogleFlowAppUrl(url) && !IsGoogleAuthRelatedUrl(url))
        {
            CloseBulkPanelIfOpen();
        }
        if ((_bulkPanelOpen || _workflowReady) && FlowView.CoreWebView2 != null && !string.IsNullOrWhiteSpace(url) && IsGoogleFlowAppUrl(url))
        {
            _ = EnsureVeoContentBundleOnFlowAsync();
        }
        if (string.IsNullOrWhiteSpace(url)) return;
        PostToBulkAndWorkflow(new { type = "veo-flow-url", url });
    }

    bool TryHandleVeoFlowMessage(JsonElement root)
    {
        if (!root.TryGetProperty("type", out var typeEl)) return false;
        var type = typeEl.GetString();

        if (type == "veo-status")
        {
            if (root.TryGetProperty("payload", out var payload))
            {
                PostToBulkAndWorkflow(new { type = "veo-status", payload });
            }
            return true;
        }

        if (type == "veo-bg")
        {
            var reqId = root.TryGetProperty("reqId", out var rEl) ? rEl.GetString() ?? "" : "";
            var msg = root.TryGetProperty("message", out var mEl) ? mEl.Clone() : default;
            _ = Task.Run(async () =>
            {
                var result = await HandleVeoBgCommandAsync(msg);
                var resJson = JsonSerializer.Serialize(result);
                await Dispatcher.InvokeAsync(async () =>
                {
                    try
                    {
                        if (FlowView.CoreWebView2 != null)
                        {
                            await FlowView.CoreWebView2.ExecuteScriptAsync(
                                $"window.__veoBgResolve && window.__veoBgResolve({JsString(reqId)}, {resJson});");
                        }
                    }
                    catch { /* ignore */ }
                });
            });
            return true;
        }

        return false;
    }

    async void BulkOrWorkflow_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        var root = ParseMessage(e);
        if (root.ValueKind != JsonValueKind.Object) return;
        if (!root.TryGetProperty("type", out var typeEl)) return;
        var type = typeEl.GetString();
        var senderCore = sender as CoreWebView2;

        switch (type)
        {
            case "veo-tabs-send":
            {
                var reqId = root.TryGetProperty("reqId", out var rEl) ? rEl.GetString() ?? "" : "";
                var msgRaw = root.TryGetProperty("message", out var mEl) ? mEl.GetRawText() : "{}";
                var result = await DispatchToFlowContentScriptAsync(msgRaw, mEl);
                PostToCore(senderCore, new { type = "veo-tabs-result", reqId, result });
                break;
            }
            case "veo-open-workflow":
            case "veo-focus-workflow":
            {
                OpenOrFocusWorkflowWindow();
                break;
            }
            case "veo-navigate-flow":
            {
                var url = root.TryGetProperty("url", out var uEl) ? uEl.GetString() : "https://flow.google.com/";
                if (!string.IsNullOrWhiteSpace(url))
                    _ = NavigateFlowSafeAsync(url!);
                break;
            }
            case "veo-reload-flow":
            {
                FlowView.CoreWebView2?.Reload();
                break;
            }
            case "veo-storage-sync":
            {
                var area = root.TryGetProperty("area", out var aEl) ? aEl.GetString() ?? "local" : "local";
                var changes = root.TryGetProperty("changes", out var cEl) ? cEl.Clone() : default;
                var syncPayload = new { type = "veo-storage-sync", area, changes };
                if (senderCore != BulkView.CoreWebView2 && _bulkReady)
                    PostToCore(BulkView.CoreWebView2, syncPayload);
                if (senderCore != _workflowWebView?.CoreWebView2 && _workflowReady)
                    PostToCore(_workflowWebView?.CoreWebView2, syncPayload);
                break;
            }
            case "veo-ui-message":
            {
                var reqId = root.TryGetProperty("reqId", out var rEl) ? rEl.GetString() ?? "" : "";
                if (root.TryGetProperty("message", out var mEl))
                {
                    var msgClone = mEl.Clone();
                    var bcast = new { type = "veo-ui-broadcast", reqId, payload = msgClone };
                    if (senderCore != BulkView.CoreWebView2 && _bulkReady)
                        PostToCore(BulkView.CoreWebView2, bcast);
                    if (senderCore != _workflowWebView?.CoreWebView2 && _workflowReady)
                        PostToCore(_workflowWebView?.CoreWebView2, bcast);
                }
                break;
            }
            case "veo-ui-broadcast-reply":
            {
                var reqId = root.TryGetProperty("reqId", out var rEl) ? rEl.GetString() ?? "" : "";
                var result = root.TryGetProperty("result", out var resEl) ? resEl.Clone() : default;
                PostToBulkAndWorkflow(new { type = "veo-tabs-result", reqId, result });
                break;
            }
            case "veo-bg":
            {
                var reqId = root.TryGetProperty("reqId", out var rEl) ? rEl.GetString() ?? "" : "";
                var msg = root.TryGetProperty("message", out var mEl) ? mEl.Clone() : default;
                var result = await HandleVeoBgCommandAsync(msg);
                PostToCore(senderCore, new { type = "veo-tabs-result", reqId, result });
                break;
            }
        }
    }

    async Task<object?> DispatchToFlowContentScriptAsync(string msgRawJson, JsonElement msgEl)
    {
        try
        {
            var isCheckPage = msgEl.ValueKind == JsonValueKind.Object &&
                              msgEl.TryGetProperty("type", out var tEl) &&
                              tEl.GetString() == "CHECK_FLOW_PAGE";

            return await await Dispatcher.InvokeAsync(async () =>
            {
                if (FlowView.CoreWebView2 == null)
                    return (object?)(new { isFlowPage = true, success = false, error = "Flow view not ready" });

                var curUrl = FlowView.CoreWebView2.Source ?? "";
                if (isCheckPage)
                {
                    return new { isFlowPage = true };
                }

                await EnsureVeoContentBundleOnFlowAsync();

                var expr = $"(window.__veoDispatch ? window.__veoDispatch({msgRawJson}) : Promise.resolve({{ isFlowPage: true, success: true }}))";
                var cdpParams = JsonSerializer.Serialize(new
                {
                    expression = expr,
                    awaitPromise = true,
                    returnByValue = true
                });

                var rawResp = await FlowView.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.evaluate", cdpParams);
                using var doc = JsonDocument.Parse(rawResp);
                if (doc.RootElement.TryGetProperty("result", out var resObj) &&
                    resObj.TryGetProperty("value", out var valEl))
                {
                    return JsonSerializer.Deserialize<object>(valEl.GetRawText());
                }
                return new { success = true };
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine("[BulkMode] DispatchToFlowContentScript error: " + ex.Message);
            return new { success = false, error = ex.Message };
        }
    }

    async Task<object?> HandleVeoBgCommandAsync(JsonElement msg)
    {
        if (msg.ValueKind != JsonValueKind.Object || !msg.TryGetProperty("type", out var tEl))
            return new { success = false, error = "Invalid message" };

        var type = tEl.GetString() ?? "";
        try
        {
            switch (type)
            {
                case "GET_REMOTE_CONFIG":
                    return await GetVeoRemoteConfigAsync();

                case "CA":
                case "CD":
                case "SET_ZOOM":
                    return new { success = true };

                case "SET_FOLDER_NAME":
                {
                    if (msg.TryGetProperty("folderName", out var fn) && fn.ValueKind == JsonValueKind.String)
                        _veoDownloadFolder = fn.GetString()?.Trim() ?? "";
                    if (msg.TryGetProperty("prefix", out var pf) && pf.ValueKind == JsonValueKind.String)
                        _veoDownloadPrefix = pf.GetString()?.Trim() ?? "";
                    if (msg.TryGetProperty("autoChangeFileName", out var ac) && (ac.ValueKind == JsonValueKind.True || ac.ValueKind == JsonValueKind.False))
                        _veoAutoChangeFileName = ac.GetBoolean();
                    return new { success = true };
                }

                case "CIT":
                {
                    var text = msg.TryGetProperty("text", out var tx) ? tx.GetString() ?? "" : "";
                    await await Dispatcher.InvokeAsync(async () =>
                    {
                        if (FlowView.CoreWebView2 == null) return;
                        var p = JsonSerializer.Serialize(new { text });
                        await FlowView.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.insertText", p);
                    });
                    return new { success = true };
                }

                case "CK":
                {
                    var key = msg.TryGetProperty("key", out var kEl) ? kEl.GetString() ?? "" : "";
                    var code = msg.TryGetProperty("code", out var cEl) ? cEl.GetString() ?? "" : "";
                    var keyCode = msg.TryGetProperty("keyCode", out var kcEl) && kcEl.TryGetInt32(out var kc) ? kc : 0;
                    var text = msg.TryGetProperty("text", out var txEl) && txEl.ValueKind == JsonValueKind.String ? txEl.GetString() : null;
                    var modifiers = msg.TryGetProperty("modifiers", out var mEl) && mEl.TryGetInt32(out var mod) ? mod : (int?)null;
                    var keyType = msg.TryGetProperty("keyType", out var ktEl) && ktEl.ValueKind == JsonValueKind.String ? ktEl.GetString() : null;
                    string[]? commands = null;
                    if (msg.TryGetProperty("commands", out var cmdEl) && cmdEl.ValueKind == JsonValueKind.Array)
                    {
                        commands = cmdEl.EnumerateArray()
                            .Where(x => x.ValueKind == JsonValueKind.String)
                            .Select(x => x.GetString()!)
                            .ToArray();
                    }

                    await await Dispatcher.InvokeAsync(async () =>
                    {
                        if (FlowView.CoreWebView2 == null) return;
                        string BuildKeyJson(string evType)
                        {
                            var dict = new Dictionary<string, object?>
                            {
                                ["type"] = evType,
                                ["key"] = key,
                                ["code"] = code,
                                ["windowsVirtualKeyCode"] = keyCode,
                                ["nativeVirtualKeyCode"] = keyCode
                            };
                            if (text != null)
                            {
                                dict["text"] = text;
                                dict["unmodifiedText"] = text;
                            }
                            if (modifiers.HasValue)
                                dict["modifiers"] = modifiers.Value;
                            if (commands != null && commands.Length > 0)
                                dict["commands"] = commands;
                            return JsonSerializer.Serialize(dict);
                        }

                        if (!string.IsNullOrWhiteSpace(keyType))
                        {
                            await FlowView.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", BuildKeyJson(keyType!));
                        }
                        else
                        {
                            await FlowView.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", BuildKeyJson("keyDown"));
                            await Task.Delay(_veoRng.Next(30, 85));
                            await FlowView.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", BuildKeyJson("keyUp"));
                        }
                    });
                    return new { success = true };
                }

                case "CH":
                {
                    var x = msg.TryGetProperty("x", out var xEl) ? xEl.GetDouble() : 0;
                    var y = msg.TryGetProperty("y", out var yEl) ? yEl.GetDouble() : 0;
                    await await Dispatcher.InvokeAsync(() => VeoSmoothMouseMoveAsync(x, y));
                    return new { success = true };
                }

                case "CC":
                {
                    var x = msg.TryGetProperty("x", out var xEl) ? xEl.GetDouble() : 0;
                    var y = msg.TryGetProperty("y", out var yEl) ? yEl.GetDouble() : 0;
                    await await Dispatcher.InvokeAsync(async () =>
                    {
                        if (FlowView.CoreWebView2 == null) return;
                        await VeoSmoothMouseMoveAsync(x, y);
                        await Task.Delay(_veoRng.Next(35, 95));
                        var rx = (int)Math.Round(x);
                        var ry = (int)Math.Round(y);
                        var downJson = $"{{\"type\":\"mousePressed\",\"x\":{rx},\"y\":{ry},\"button\":\"left\",\"buttons\":1,\"clickCount\":1,\"modifiers\":0}}";
                        var upJson = $"{{\"type\":\"mouseReleased\",\"x\":{rx},\"y\":{ry},\"button\":\"left\",\"buttons\":0,\"clickCount\":1,\"modifiers\":0}}";
                        await FlowView.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", downJson);
                        await Task.Delay(_veoRng.Next(45, 110));
                        await FlowView.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", upJson);
                    });
                    return new { success = true };
                }

                case "DOWNLOAD_RESOURCE":
                case "DOWNLOAD_VIDEO":
                {
                    var url = msg.TryGetProperty("url", out var uEl) ? uEl.GetString() ?? "" : "";
                    var filename = msg.TryGetProperty("filename", out var fEl) ? fEl.GetString() ?? "" : "";
                    var folder = msg.TryGetProperty("folder", out var fdEl) ? fdEl.GetString() ?? "" : "";
                    var autoChange = !msg.TryGetProperty("autoChangeFileName", out var acEl) || acEl.ValueKind != JsonValueKind.False;
                    return await DownloadVeoResourceAsync(url, filename, folder, autoChange);
                }

                default:
                    return new { success = true };
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BulkMode] HandleVeoBgCommand ({type}) error: " + ex.Message);
            return new { success = false, error = ex.Message };
        }
    }

    async Task VeoSmoothMouseMoveAsync(double targetX, double targetY)
    {
        if (FlowView.CoreWebView2 == null) return;
        double startX = _veoMouseX;
        double startY = _veoMouseY;
        double dx = targetX - startX;
        double dy = targetY - startY;
        double dist = Math.Sqrt(dx * dx + dy * dy);
        int steps = Math.Max(5, Math.Min(18, (int)Math.Round(dist / 24.0 + _veoRng.Next(2, 6))));
        double bend = (_veoRng.NextDouble() * 0.4 - 0.2) * dist;
        double nx = dist > 0.01 ? -(targetY - startY) / dist : 0;
        double ny = dist > 0.01 ? (targetX - startX) / dist : 0;
        double cx = (startX + targetX) / 2.0 + nx * bend;
        double cy = (startY + targetY) / 2.0 + ny * bend;

        for (int i = 1; i <= steps; i++)
        {
            double t = (double)i / steps;
            double ease = t < 0.5 ? 2 * t * t : 1 - Math.Pow(-2 * t + 2, 2) / 2;
            double px = i == steps ? targetX : Math.Pow(1 - ease, 2) * startX + 2 * (1 - ease) * ease * cx + ease * ease * targetX;
            double py = i == steps ? targetY : Math.Pow(1 - ease, 2) * startY + 2 * (1 - ease) * ease * cy + ease * ease * targetY;
            var moveJson = $"{{\"type\":\"mouseMoved\",\"x\":{(int)Math.Round(px)},\"y\":{(int)Math.Round(py)},\"button\":\"none\",\"buttons\":0,\"modifiers\":0}}";
            await FlowView.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", moveJson);
            await Task.Delay(_veoRng.Next(6, 15));
        }

        _veoMouseX = targetX;
        _veoMouseY = targetY;
    }

    async Task<object?> GetVeoRemoteConfigAsync()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (_veoLiveConfig.HasValue && (now - _veoConfigFetchedAtMs) < 600_000)
            return _veoLiveConfig.Value;

        foreach (var host in new[] { "https://configs.kylenguyen.me", "https://configs2.kylenguyen.me" })
        {
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, host + "/config/flow-automation-2");
                req.Headers.TryAddWithoutValidation("X-Client-Secret", "YES_THAT_IS_VERY_EASY_RIGHT_?!$");
                using var resp = await _veoHttp.SendAsync(req);
                if (resp.IsSuccessStatusCode)
                {
                    var json = await resp.Content.ReadAsStringAsync();
                    var el = JsonDocument.Parse(json).RootElement.Clone();
                    if (el.TryGetProperty("selectors", out _))
                    {
                        _veoLiveConfig = el;
                        _veoConfigFetchedAtMs = now;
                        return el;
                    }
                }
            }
            catch { /* fallback below */ }
        }

        return _veoFallbackConfig;
    }

    string? _pendingDirectDownloadTarget;
    TaskCompletionSource<string?>? _pendingDirectDownloadTcs;

    static string NormalizeVeoFileName(string? rawName, string? url)
    {
        var origName = (rawName ?? "").Trim();
        var ext = Path.GetExtension(origName);
        var hasValidExt = !string.IsNullOrWhiteSpace(ext) && KnownDownloadExtensions.Contains(ext);
        if (!hasValidExt)
        {
            ext = InferExtensionFromMimeOrUrl(null, url)
                  ?? ((url ?? "").Contains("=mm", StringComparison.OrdinalIgnoreCase) ? ".mp4" : ".mp4");
        }
        var stem = hasValidExt ? Path.GetFileNameWithoutExtension(origName) : origName;
        if (string.IsNullOrWhiteSpace(stem) ||
            stem.Length > 60 ||
            stem.StartsWith("ANqvL", StringComparison.Ordinal) ||
            stem.Contains("=mm,", StringComparison.OrdinalIgnoreCase))
        {
            var kind = (ext is ".png" or ".jpg" or ".jpeg" or ".webp" or ".gif") ? "image" : "video";
            stem = $"flow_{kind}_{DateTime.Now:yyyyMMdd_HHmmss}";
        }
        return SanitizeFileName(stem + ext);
    }

    static bool IsHtmlPayload(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length == 0) return true;
        int i = 0;
        while (i < bytes.Length && i < 32 && (bytes[i] == (byte)' ' || bytes[i] == (byte)'\t' || bytes[i] == (byte)'\r' || bytes[i] == (byte)'\n' || bytes[i] == 0xEF || bytes[i] == 0xBB || bytes[i] == 0xBF))
            i++;
        var rem = bytes[i..];
        if (rem.Length >= 9 &&
            rem[0] == (byte)'<' &&
            (rem[1] == (byte)'!' || rem[1] == (byte)'h' || rem[1] == (byte)'H'))
            return true;
        return false;
    }

    async Task<byte[]?> DownloadBytesWithFlowCookiesAsync(string url)
    {
        try
        {
            var jar = new System.Net.CookieContainer();
            await Dispatcher.InvokeAsync(async () =>
            {
                if (FlowView.CoreWebView2?.CookieManager == null) return;
                var cookies = await FlowView.CoreWebView2.CookieManager.GetCookiesAsync("");
                foreach (var c in cookies)
                {
                    try
                    {
                        var dom = string.IsNullOrWhiteSpace(c.Domain) ? "google.com" : c.Domain;
                        jar.Add(new System.Net.Cookie(c.Name, c.Value, string.IsNullOrWhiteSpace(c.Path) ? "/" : c.Path, dom));
                    }
                    catch { /* ignore invalid cookie */ }
                }
            }).Task.Unwrap();

            using var handler = new HttpClientHandler
            {
                UseCookies = true,
                CookieContainer = jar,
                AllowAutoRedirect = true,
                AutomaticDecompression = System.Net.DecompressionMethods.All
            };
            using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(90) };
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
            req.Headers.TryAddWithoutValidation("Referer", "https://labs.google/");
            using var resp = await client.SendAsync(req);
            if (!resp.IsSuccessStatusCode) return null;
            var ct = resp.Content.Headers.ContentType?.MediaType ?? "";
            if (ct.Contains("text/html", StringComparison.OrdinalIgnoreCase)) return null;
            var bytes = await resp.Content.ReadAsByteArrayAsync();
            if (IsHtmlPayload(bytes)) return null;
            return bytes;
        }
        catch
        {
            return null;
        }
    }

    async Task<string?> DownloadViaFlowWebViewAsync(string url, string targetPath)
    {
        try
        {
            var tcs = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
            _pendingDirectDownloadTarget = targetPath;
            _pendingDirectDownloadTcs = tcs;

            await Dispatcher.InvokeAsync(async () =>
            {
                if (FlowView.CoreWebView2 == null)
                {
                    tcs.TrySetResult(null);
                    return;
                }
                var uJson = JsonSerializer.Serialize(url);
                var nJson = JsonSerializer.Serialize(Path.GetFileName(targetPath));
                var js = $@"(() => {{
                    try {{
                        const a = document.createElement('a');
                        a.href = {uJson};
                        a.download = {nJson};
                        a.style.display = 'none';
                        document.body.appendChild(a);
                        a.click();
                        setTimeout(() => a.remove(), 2000);
                    }} catch (e) {{}}
                }})()";
                await FlowView.CoreWebView2.ExecuteScriptAsync(js);
            }).Task.Unwrap();

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
            using var reg = cts.Token.Register(() => tcs.TrySetResult(null));
            return await tcs.Task;
        }
        catch
        {
            return null;
        }
        finally
        {
            _pendingDirectDownloadTarget = null;
            _pendingDirectDownloadTcs = null;
        }
    }

    async Task<object> DownloadVeoResourceAsync(string url, string filename, string folder, bool autoChangeFileName)
    {
        if (string.IsNullOrWhiteSpace(url))
            return new { success = false, error = "Empty download URL" };

        var downloadsRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        var relFolder = autoChangeFileName ? SanitizeRelativeFolder(folder) : "";
        var targetDir = string.IsNullOrWhiteSpace(relFolder) ? downloadsRoot : Path.Combine(downloadsRoot, relFolder);
        Directory.CreateDirectory(targetDir);

        var safeName = NormalizeVeoFileName(filename, url);
        var fullPath = GetUniqueFilePath(Path.Combine(targetDir, safeName));

        PostToShell(new
        {
            type = "download",
            phase = "started",
            data = new { filename = Path.GetFileName(fullPath), totalBytes = 0 }
        });

        try
        {
            byte[]? bytes = null;
            if (url.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
            {
                var comma = url.IndexOf(',');
                if (comma < 0)
                    return new { success = false, error = "Invalid data URL" };
                bytes = Convert.FromBase64String(url[(comma + 1)..]);
            }
            else
            {
                bytes = await DownloadBytesWithFlowCookiesAsync(url);
                if (bytes == null || IsHtmlPayload(bytes))
                {
                    var nativeSaved = await DownloadViaFlowWebViewAsync(url, fullPath);
                    if (!string.IsNullOrEmpty(nativeSaved) && File.Exists(nativeSaved))
                    {
                        return new { success = true, downloadId = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), path = nativeSaved };
                    }
                    throw new IOException("Authenticated media download failed");
                }
            }

            var magicExt = DetectExtensionFromBytes(bytes);
            if (!string.IsNullOrEmpty(magicExt))
            {
                var curExt = Path.GetExtension(fullPath);
                if (string.IsNullOrEmpty(curExt) || !string.Equals(curExt, magicExt, StringComparison.OrdinalIgnoreCase))
                {
                    var dir = Path.GetDirectoryName(fullPath) ?? targetDir;
                    var stem = Path.GetFileNameWithoutExtension(fullPath);
                    if (string.IsNullOrWhiteSpace(stem) || stem.Length > 60 || stem.StartsWith("ANqvL", StringComparison.Ordinal))
                        stem = $"flow_{(magicExt is ".mp4" or ".webm" ? "video" : "image")}_{DateTime.Now:yyyyMMdd_HHmmss}";
                    fullPath = GetUniqueFilePath(Path.Combine(dir, stem + magicExt));
                }
            }

            await File.WriteAllBytesAsync(fullPath, bytes);
            PostToShell(new
            {
                type = "download",
                phase = "completed",
                data = new { filename = Path.GetFileName(fullPath), savePath = fullPath }
            });
            return new { success = true, downloadId = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), path = fullPath };
        }
        catch (Exception ex)
        {
            PostToShell(new
            {
                type = "download",
                phase = "failed",
                data = new { filename = Path.GetFileName(fullPath), state = "interrupted" }
            });
            return new { success = false, error = ex.Message };
        }
    }

    static readonly HashSet<string> KnownDownloadExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp4", ".webm", ".mov", ".mkv", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp3", ".wav", ".ogg", ".m4a", ".zip", ".json", ".txt", ".csv", ".xlsx", ".pdf"
    };

    static string? InferExtensionFromMimeOrUrl(string? mime, string? uri)
    {
        var m = (mime ?? "").ToLowerInvariant();
        if (m.Contains("video/mp4")) return ".mp4";
        if (m.Contains("video/webm")) return ".webm";
        if (m.Contains("video/quicktime")) return ".mov";
        if (m.Contains("image/png")) return ".png";
        if (m.Contains("image/jpeg") || m.Contains("image/jpg")) return ".jpg";
        if (m.Contains("image/webp")) return ".webp";
        if (m.Contains("image/gif")) return ".gif";
        if (m.Contains("audio/mpeg") || m.Contains("audio/mp3")) return ".mp3";
        if (m.Contains("audio/wav") || m.Contains("audio/x-wav")) return ".wav";
        if (m.StartsWith("video/")) return ".mp4";
        if (m.StartsWith("image/")) return ".png";

        var u = (uri ?? "").ToLowerInvariant();
        if (u.Contains("mime=video") || u.Contains("video_mp4") || u.Contains(".mp4")) return ".mp4";
        if (u.Contains("mime=image/png") || u.Contains(".png")) return ".png";
        if (u.Contains("mime=image/jpeg") || u.Contains(".jpg") || u.Contains(".jpeg")) return ".jpg";
        if (u.Contains("mime=image/webp") || u.Contains(".webp")) return ".webp";
        return null;
    }

    static string? DetectExtensionFromBytes(ReadOnlySpan<byte> header)
    {
        if (header.Length >= 8 &&
            header[0] == 0x89 && header[1] == 0x50 && header[2] == 0x4E && header[3] == 0x47)
            return ".png";
        if (header.Length >= 3 &&
            header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF)
            return ".jpg";
        if (header.Length >= 12 &&
            header[0] == (byte)'R' && header[1] == (byte)'I' && header[2] == (byte)'F' && header[3] == (byte)'F' &&
            header[8] == (byte)'W' && header[9] == (byte)'E' && header[10] == (byte)'B' && header[11] == (byte)'P')
            return ".webp";
        if (header.Length >= 4 &&
            header[0] == (byte)'G' && header[1] == (byte)'I' && header[2] == (byte)'F' && header[3] == (byte)'8')
            return ".gif";
        if (header.Length >= 8 &&
            header[4] == (byte)'f' && header[5] == (byte)'t' && header[6] == (byte)'y' && header[7] == (byte)'p')
            return ".mp4";
        if (header.Length >= 4 &&
            header[0] == 0x1A && header[1] == 0x45 && header[2] == 0xDF && header[3] == 0xA3)
            return ".webm";
        if (header.Length >= 12 &&
            header[0] == (byte)'R' && header[1] == (byte)'I' && header[2] == (byte)'F' && header[3] == (byte)'F' &&
            header[8] == (byte)'W' && header[9] == (byte)'A' && header[10] == (byte)'V' && header[11] == (byte)'E')
            return ".wav";
        if (header.Length >= 3 &&
            ((header[0] == (byte)'I' && header[1] == (byte)'D' && header[2] == (byte)'3') ||
             (header[0] == 0xFF && (header[1] & 0xE0) == 0xE0)))
            return ".mp3";
        return null;
    }

    static string EnsureDownloadedFileExtension(string filePath)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath)) return filePath;
            Span<byte> buf = stackalloc byte[16];
            int read;
            using (var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                read = fs.Read(buf);
            }
            var detected = DetectExtensionFromBytes(buf[..read]);
            if (string.IsNullOrEmpty(detected)) return filePath;

            var curExt = Path.GetExtension(filePath);
            if (!string.IsNullOrEmpty(curExt) && string.Equals(curExt, detected, StringComparison.OrdinalIgnoreCase))
                return filePath;
            if (curExt.Equals(".jpeg", StringComparison.OrdinalIgnoreCase) && detected == ".jpg")
                return filePath;

            var dir = Path.GetDirectoryName(filePath) ?? "";
            var stem = Path.GetFileNameWithoutExtension(filePath);
            if (string.IsNullOrWhiteSpace(stem) || stem.Length > 60 || stem.StartsWith("ANqvL", StringComparison.Ordinal))
            {
                var kind = (detected is ".mp4" or ".webm" or ".mov") ? "video" : "image";
                stem = $"flow_{kind}_{DateTime.Now:yyyyMMdd_HHmmss}";
            }
            var newPath = GetUniqueFilePath(Path.Combine(dir, stem + detected));
            File.Move(filePath, newPath);
            return newPath;
        }
        catch
        {
            return filePath;
        }
    }

    void ApplyVeoDownloadPath(CoreWebView2DownloadStartingEventArgs e)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(_pendingDirectDownloadTarget))
            {
                e.ResultFilePath = _pendingDirectDownloadTarget;
                return;
            }
            var downloadsRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            var relFolder = _veoAutoChangeFileName ? SanitizeRelativeFolder(_veoDownloadFolder) : "";
            var targetDir = string.IsNullOrWhiteSpace(relFolder) ? downloadsRoot : Path.Combine(downloadsRoot, relFolder);
            Directory.CreateDirectory(targetDir);

            var origName = Path.GetFileName(e.ResultFilePath);
            var ext = Path.GetExtension(origName);
            var hasValidExt = !string.IsNullOrWhiteSpace(ext) && KnownDownloadExtensions.Contains(ext);
            var inferredExt = InferExtensionFromMimeOrUrl(e.DownloadOperation?.MimeType, e.DownloadOperation?.Uri);

            if (!hasValidExt)
            {
                ext = inferredExt ?? ".mp4";
            }

            var stem = hasValidExt ? Path.GetFileNameWithoutExtension(origName) : origName;
            if (string.IsNullOrWhiteSpace(stem) ||
                stem.Length > 60 ||
                stem.StartsWith("ANqvL", StringComparison.Ordinal) ||
                stem.Contains("=mm,", StringComparison.OrdinalIgnoreCase))
            {
                var kind = (ext is ".png" or ".jpg" or ".jpeg" or ".webp" or ".gif") ? "image" : "video";
                stem = $"flow_{kind}_{DateTime.Now:yyyyMMdd_HHmmss}";
            }

            if (_veoAutoChangeFileName &&
                !string.IsNullOrWhiteSpace(_veoDownloadPrefix) &&
                !stem.StartsWith(_veoDownloadPrefix, StringComparison.OrdinalIgnoreCase))
            {
                stem = _veoDownloadPrefix + stem;
            }

            var safeName = SanitizeFileName(stem + ext);
            e.ResultFilePath = GetUniqueFilePath(Path.Combine(targetDir, safeName));
        }
        catch (Exception ex)
        {
            Debug.WriteLine("[BulkMode] ApplyVeoDownloadPath error: " + ex.Message);
        }
    }

    static string SanitizeRelativeFolder(string? folder)
    {
        if (string.IsNullOrWhiteSpace(folder)) return "";
        var invalid = Path.GetInvalidPathChars();
        var parts = folder.Split(new[] { '/', '\\' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(p => string.Concat(p.Trim().Where(c => !invalid.Contains(c) && c != ':' && c != '*' && c != '?' && c != '"' && c != '<' && c != '>' && c != '|')))
            .Where(p => !string.IsNullOrWhiteSpace(p) && p != "." && p != "..");
        return string.Join(Path.DirectorySeparatorChar, parts);
    }

    static string SanitizeFileName(string name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = string.Concat(name.Select(c => invalid.Contains(c) ? '_' : c)).Trim();
        return string.IsNullOrWhiteSpace(cleaned) ? "flow_output.mp4" : cleaned;
    }

    static string GetUniqueFilePath(string fullPath)
    {
        if (!File.Exists(fullPath)) return fullPath;
        var dir = Path.GetDirectoryName(fullPath) ?? "";
        var stem = Path.GetFileNameWithoutExtension(fullPath);
        var ext = Path.GetExtension(fullPath);
        for (int i = 1; i < 10000; i++)
        {
            var candidate = Path.Combine(dir, $"{stem} ({i}){ext}");
            if (!File.Exists(candidate)) return candidate;
        }
        return fullPath;
    }
}
