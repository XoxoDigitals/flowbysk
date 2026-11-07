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
    string _urbanVpnExtensionId = "";
    Window? _vpnPopupWindow;
    WebView2? _vpnWebView;
    bool _vpnClosingForGood;
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

    double RightBulkMargin => (_bulkPanelOpen && _shellMode != "full") ? BulkPanelWidth : 0;

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
            if (IsFlowWorkspaceUrl(curUrl))
            {
                await flowCore.ExecuteScriptAsync(_veoContentBundle);
                await flowCore.ExecuteScriptAsync("try { if (typeof window.__veoStartModules === 'function') window.__veoStartModules(); } catch(e) {}");
            }
        }
        catch { /* ignore */ }
    }

    void SyncBulkLayout()
    {
        if (_shellMode == "full")
        {
            BulkView.Visibility = Visibility.Collapsed;
            return;
        }

        BulkView.Margin = new Thickness(0, _chromeHeight, 0, 0);
        BulkView.Visibility = _bulkPanelOpen ? Visibility.Visible : Visibility.Collapsed;
        FlowView.Margin = new Thickness(0, _chromeHeight, RightBulkMargin, 0);
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

    async Task EnsureUrbanVpnExtensionLoadedAsync()
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(_urbanVpnExtensionId)) return;
            var profile = FlowView.CoreWebView2?.Profile;
            if (profile == null) return;

            var extDir = Path.Combine(_wwwRoot, "extensions", "urban-vpn");
            if (!Directory.Exists(extDir)) return;

            try
            {
                var ext = await profile.AddBrowserExtensionAsync(extDir);
                if (ext != null)
                {
                    _urbanVpnExtensionId = ext.Id ?? "";
                    if (!ext.IsEnabled)
                        await ext.EnableAsync(true);
                    Debug.WriteLine("[VPN] Loaded Urban VPN extension: " + _urbanVpnExtensionId);
                    return;
                }
            }
            catch (Exception addEx)
            {
                Debug.WriteLine("[VPN] AddBrowserExtensionAsync fallback: " + addEx.Message);
            }

            var existing = await profile.GetBrowserExtensionsAsync();
            foreach (var item in existing)
            {
                if (item.Name != null && item.Name.Contains("Urban", StringComparison.OrdinalIgnoreCase))
                {
                    try
                    {
                        await item.RemoveAsync();
                    }
                    catch { /* ignore */ }
                }
            }

            try
            {
                var ext2 = await profile.AddBrowserExtensionAsync(extDir);
                if (ext2 != null)
                {
                    _urbanVpnExtensionId = ext2.Id ?? "";
                    if (!ext2.IsEnabled)
                        await ext2.EnableAsync(true);
                    return;
                }
            }
            catch { /* ignore */ }

            var afterList = await profile.GetBrowserExtensionsAsync();
            foreach (var item in afterList)
            {
                if (item.Name != null && item.Name.Contains("Urban", StringComparison.OrdinalIgnoreCase))
                {
                    _urbanVpnExtensionId = item.Id ?? "";
                    if (!item.IsEnabled)
                        await item.EnableAsync(true);
                    break;
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine("[VPN] EnsureUrbanVpnExtensionLoadedAsync error: " + ex.Message);
        }
    }

    void PositionVpnPopupWindow(Window win)
    {
        try
        {
            if (WindowState == WindowState.Maximized)
            {
                var workArea = SystemParameters.WorkArea;
                win.Left = Math.Max(workArea.Left + 12, workArea.Right - win.Width - 24);
                win.Top = workArea.Top + _chromeHeight + 6;
            }
            else
            {
                win.Left = Math.Max(12, Left + ActualWidth - win.Width - 24);
                win.Top = Top + _chromeHeight + 6;
            }
        }
        catch { /* ignore */ }
    }

    void ToggleVpnPopup()
    {
        Dispatcher.Invoke(async () =>
        {
            try
            {
                if (_vpnPopupWindow != null && _vpnPopupWindow.IsLoaded)
                {
                    if (_vpnPopupWindow.IsVisible)
                    {
                        _vpnPopupWindow.Hide();
                        return;
                    }
                    PositionVpnPopupWindow(_vpnPopupWindow);
                    _vpnPopupWindow.Show();
                    _vpnPopupWindow.Activate();
                    return;
                }

                if (_flowEnv == null) return;
                await EnsureUrbanVpnExtensionLoadedAsync();
                if (string.IsNullOrWhiteSpace(_urbanVpnExtensionId)) return;

                var wv = new WebView2
                {
                    DefaultBackgroundColor = System.Drawing.Color.FromArgb(0xFF, 0x1E, 0x20, 0x29)
                };

                var win = new Window
                {
                    Title = "Urban VPN",
                    Icon = Icon,
                    Width = 316,
                    Height = 623,
                    ResizeMode = ResizeMode.NoResize,
                    WindowStartupLocation = WindowStartupLocation.Manual,
                    Owner = this,
                    ShowInTaskbar = false,
                    Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x20, 0x29)),
                    Content = wv
                };

                PositionVpnPopupWindow(win);
                _vpnPopupWindow = win;
                _vpnWebView = wv;

                win.Closing += (_, e) =>
                {
                    if (!_vpnClosingForGood)
                    {
                        e.Cancel = true;
                        win.Hide();
                    }
                };

                win.Loaded += async (_, _) =>
                {
                    try
                    {
                        await wv.EnsureCoreWebView2Async(_flowEnv);
                        wv.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                        wv.CoreWebView2.Settings.AreDevToolsEnabled = false;
                        wv.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
                        wv.CoreWebView2.Settings.IsStatusBarEnabled = false;
                        wv.CoreWebView2.Settings.IsZoomControlEnabled = false;
                        ApplyChromeUserAgent(wv.CoreWebView2);
                        wv.CoreWebView2.NewWindowRequested += (_, ne) =>
                        {
                            ne.Handled = true;
                        };
                        wv.CoreWebView2.Navigate($"chrome-extension://{_urbanVpnExtensionId}/popup/index.html");
                    }
                    catch (Exception ex)
                    {
                        Debug.WriteLine("[VPN] Popup WebView2 init failed: " + ex.Message);
                    }
                };

                win.Show();
                win.Activate();
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[VPN] ToggleVpnPopup error: " + ex.Message);
            }
        });
    }

    void CloseVpnPopupWindow()
    {
        try
        {
            _vpnClosingForGood = true;
            _vpnPopupWindow?.Close();
            _vpnPopupWindow = null;
            _vpnWebView = null;
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
        if ((_bulkPanelOpen || _workflowReady) && FlowView.CoreWebView2 != null && !string.IsNullOrWhiteSpace(url) && IsFlowWorkspaceUrl(url))
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

    async Task<object> DownloadVeoResourceAsync(string url, string filename, string folder, bool autoChangeFileName)
    {
        if (string.IsNullOrWhiteSpace(url))
            return new { success = false, error = "Empty download URL" };

        var downloadsRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        var relFolder = autoChangeFileName ? SanitizeRelativeFolder(folder) : "";
        var targetDir = string.IsNullOrWhiteSpace(relFolder) ? downloadsRoot : Path.Combine(downloadsRoot, relFolder);
        Directory.CreateDirectory(targetDir);

        var safeName = SanitizeFileName(string.IsNullOrWhiteSpace(filename) ? $"flow_{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}.mp4" : filename);
        var fullPath = GetUniqueFilePath(Path.Combine(targetDir, safeName));

        PostToShell(new
        {
            type = "download",
            phase = "started",
            data = new { filename = Path.GetFileName(fullPath), totalBytes = 0 }
        });

        try
        {
            byte[] bytes;
            if (url.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
            {
                var comma = url.IndexOf(',');
                if (comma < 0)
                    return new { success = false, error = "Invalid data URL" };
                bytes = Convert.FromBase64String(url[(comma + 1)..]);
            }
            else
            {
                bytes = await _veoHttp.GetByteArrayAsync(url);
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

    void ApplyVeoDownloadPath(CoreWebView2DownloadStartingEventArgs e)
    {
        try
        {
            if (!_veoAutoChangeFileName) return;
            if (string.IsNullOrWhiteSpace(_veoDownloadFolder) && string.IsNullOrWhiteSpace(_veoDownloadPrefix)) return;

            var downloadsRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            var relFolder = SanitizeRelativeFolder(_veoDownloadFolder);
            var targetDir = string.IsNullOrWhiteSpace(relFolder) ? downloadsRoot : Path.Combine(downloadsRoot, relFolder);
            Directory.CreateDirectory(targetDir);

            var origName = Path.GetFileName(e.ResultFilePath);
            if (string.IsNullOrWhiteSpace(origName)) origName = "flow_media.mp4";
            if (!string.IsNullOrWhiteSpace(_veoDownloadPrefix) &&
                !origName.StartsWith(_veoDownloadPrefix, StringComparison.OrdinalIgnoreCase))
            {
                origName = _veoDownloadPrefix + origName;
            }
            var safeName = SanitizeFileName(origName);
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
