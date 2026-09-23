using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace FlowBrowser;

public partial class MainWindow : Window
{
    const double ChromeHeight = 88;
    double _chromeHeight = 88;
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
    bool _onGoogleAuth;
    bool _captchaActive;
    /// <summary>Sticky until explicit login-done — keeps overlay across reloads/bounces.</summary>
    bool _authLoginActive;
    /// <summary>0=off, 1=cover, 2=captcha — only transition when this changes.</summary>
    int _authUiMode = -1;
    Window? _authCoverWindow;
    DispatcherTimer? _authCoverPinTimer;

    const int AuthUiOff = 0;
    const int AuthUiCover = 1;
    const int AuthUiCaptcha = 2;

    static readonly IntPtr HwndaTop = new(0);
    const uint SwpNomove = 0x0002;
    const uint SwpNosize = 0x0001;
    const uint SwpNoactivate = 0x0010;

    [DllImport("user32.dll")]
    static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);


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
        LocationChanged += (_, _) => SyncAuthCoverBounds();
        SizeChanged += (_, _) => SyncAuthCoverBounds();
        Activated += (_, _) =>
        {
            if (_authUiMode == AuthUiCover)
                PinAuthCoverAboveWebView();
        };
        Deactivated += (_, _) =>
        {
            // Don't keep a topmost cover over other apps
            if (_authCoverWindow != null)
                _authCoverWindow.Topmost = false;
        };
        StateChanged += (_, _) =>
        {
            if (WindowState == WindowState.Minimized)
                HideAuthCoverWindow();
            else
                ApplyAuthOverlayState();
        };
        Loaded += async (_, _) => await InitAsync();
    }

    async Task InitAsync()
    {
        _wwwRoot = WwwExtractor.ResolveWwwRoot();
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
        var shellOpts = new CoreWebView2EnvironmentOptions(
            additionalBrowserArguments: "--remote-debugging-port=9222");
        var shellEnv = await CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder: _shellUserData,
            options: shellOpts);
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
        // Suppress native alert/confirm — clipped in frameless window (use in-app modal instead)
        core.ScriptDialogOpening += (_, e) =>
        {
            var deferral = e.GetDeferral();
            try
            {
                if (e.Kind == CoreWebView2ScriptDialogKind.Alert)
                    e.Accept();
                // Confirm/Prompt: no Accept → Cancel
            }
            finally
            {
                deferral.Complete();
            }
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

        // Nav lock is MAIN-FRAME only. Never filter WebResourceRequested / fetch / XHR /
        // images / scripts — those must stay fully enabled app-wide.
        // Iframes: never cancel (recaptcha widgets load in frames).
        core.FrameNavigationStarting += (_, e) =>
        {
            // Intentionally do not cancel — background frame requests stay open
        };

        core.NavigationStarting += (_, e) =>
        {
            var uri = e.Uri ?? "";
            var cur = FlowView.CoreWebView2?.Source ?? "";

            // Captcha / recaptcha surfaces: allow any main-frame helper navigation
            // (recaptcha.net, youtube checkConnection, …) so the widget is not blanked.
            if (_captchaActive || IsCaptchaUnlockUrl(uri) || IsCaptchaUnlockUrl(cur))
            {
                UpdateAuthOverlayFromUrl(uri);
                PostToShell(new
                {
                    type = "flow-event",
                    @event = "did-start-loading",
                    url = uri
                });
                return;
            }

            // Top-level page navigation allowlist only (Flow + Google login)
            if (!IsAllowedFlowNavigation(uri))
            {
                e.Cancel = true;
                Debug.WriteLine("[NavLock] blocked top-level: " + uri);
                var fallback = string.IsNullOrWhiteSpace(_flowCredTarget)
                    ? "https://flow.google.com/"
                    : _flowCredTarget!;
                if (!string.Equals(uri, fallback, StringComparison.OrdinalIgnoreCase))
                    _ = NavigateFlowSafeAsync(fallback);
                return;
            }

            UpdateAuthOverlayFromUrl(uri);
            PostToShell(new
            {
                type = "flow-event",
                @event = "did-start-loading",
                url = uri
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
            UpdateAuthOverlayFromUrl(url);
            PostToShell(new { type = "flow-event", @event = "did-navigate", url });
            PostToShell(new { type = "flow-event", @event = "did-finish-load", url });
            PostToShell(new { type = "flow-event", @event = "dom-ready", url });
            _ = TryHostGoogleAutofillAsync(url);
        };
        core.HistoryChanged += (_, _) =>
        {
            var url = core.Source ?? "";
            UpdateAuthOverlayFromUrl(url);
            PostToShell(new { type = "flow-event", @event = "did-navigate-in-page", url });
            PostToShell(new { type = "flow-event", @event = "page-title-updated", url });
            _ = TryHostGoogleAutofillAsync(url);
        };
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            if (string.IsNullOrWhiteSpace(e.Uri) || !e.Uri.StartsWith("http", StringComparison.OrdinalIgnoreCase))
                return;
            var cur = FlowView.CoreWebView2?.Source ?? "";
            // Captcha: allow any popup. Otherwise only allowlisted top-level destinations.
            if (_captchaActive || IsCaptchaUnlockUrl(e.Uri) || IsCaptchaUnlockUrl(cur) || IsAllowedFlowNavigation(e.Uri))
            {
                core.Navigate(e.Uri);
                return;
            }
            Debug.WriteLine("[NavLock] blocked popup: " + e.Uri);
            var fallback = string.IsNullOrWhiteSpace(_flowCredTarget)
                ? "https://flow.google.com/"
                : _flowCredTarget!;
            core.Navigate(fallback);
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
            if (_shellMode == "full")
            {
                // WebView2 uses native HWNDs — ZIndex cannot cover Flow. Hide it while overlays show.
                FlowView.Visibility = Visibility.Collapsed;
                ShellView.Height = double.NaN;
                ShellView.VerticalAlignment = VerticalAlignment.Stretch;
                ShellView.Margin = new Thickness(0);
                Panel.SetZIndex(ShellView, 10);
                Panel.SetZIndex(FlowView, 1);
                SyncOverlayMargins();
                ApplyAuthOverlayState(); // hides cover while full; sticky flags kept for chrome return
            }
            else
            {
                FlowView.Visibility = Visibility.Visible;
                ShellView.Height = _chromeHeight;
                ShellView.VerticalAlignment = VerticalAlignment.Top;
                ShellView.Margin = new Thickness(0);
                FlowView.Margin = new Thickness(0, _chromeHeight, 0, 0);
                Panel.SetZIndex(ShellView, 10);
                Panel.SetZIndex(FlowView, 1);
                SyncOverlayMargins();
                ApplyAuthOverlayState();
            }
        });
    }

    static bool IsGoogleAuthUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return false;
        try
        {
            var host = new Uri(url).Host;
            return host.Equals("accounts.google.com", StringComparison.OrdinalIgnoreCase)
                   || host.EndsWith(".accounts.google.com", StringComparison.OrdinalIgnoreCase)
                   || host.Equals("accounts.youtube.com", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return url.Contains("accounts.google.com", StringComparison.OrdinalIgnoreCase);
        }
    }

    static bool IsFlowWorkspaceUrl(string? url)
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

    /// <summary>
    /// Extra Google hosts/paths that appear mid sign-in (AccountChooser, legacy ServiceLogin).
    /// </summary>
    static bool IsGoogleAuthRelatedUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return false;
        if (IsGoogleAuthUrl(url)) return true;
        try
        {
            var uri = new Uri(url);
            var host = uri.Host.ToLowerInvariant();
            var path = (uri.AbsolutePath ?? "").ToLowerInvariant();
            if (host == "google.com" || host == "www.google.com")
            {
                return path.StartsWith("/accountchooser")
                       || path.StartsWith("/signin")
                       || path.StartsWith("/accounts")
                       || path.StartsWith("/servicelogin")
                       || path.StartsWith("/logout")
                       || path.StartsWith("/oauth")
                       || path.Contains("signin")
                       || path.Contains("recaptcha");
            }
            if (host.Contains("gstatic.com") && path.Contains("recaptcha"))
                return true;
            // Post-login recovery / home-address interstitials (auto-dismissed by flow-inject)
            if (host == "gds.google.com" || host.EndsWith(".gds.google.com"))
                return true;
            return false;
        }
        catch
        {
            return url.Contains("gds.google.com", StringComparison.OrdinalIgnoreCase);
        }
    }

    /// <summary>
    /// Top-level navigations allowed in Flow Browser: Flow workspace + Google login only.
    /// Does NOT apply to iframes, XHR, fetch, images, or scripts — those are never filtered.
    /// </summary>
    bool IsAllowedFlowNavigation(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return false;
        if (url.StartsWith("about:", StringComparison.OrdinalIgnoreCase)) return true;
        if (url.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return true;
        if (url.StartsWith("blob:", StringComparison.OrdinalIgnoreCase)) return true;
        if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
            !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            return false;

        if (IsFlowWorkspaceUrl(url)) return true;
        if (IsGoogleAuthRelatedUrl(url)) return true;
        if (IsCaptchaHelperHost(url)) return true;

        // During Google sign-in, allow connectivity helpers as top-level (rare but needed)
        if (_authLoginActive || _captchaActive)
        {
            try
            {
                var host = new Uri(url).Host.ToLowerInvariant();
                if (host == "youtube.com" || host.EndsWith(".youtube.com")) return true;
                if (host == "google.com" || host == "www.google.com") return true;
                if (host.Contains("mail.google.com")) return false;
                if (host.Contains("drive.google.com")) return false;
                if (host.Contains("docs.google.com")) return false;
                if (host.Contains("myaccount.google.com")) return false;
            }
            catch { /* fall through */ }
        }

        try
        {
            var host = new Uri(url).Host.ToLowerInvariant();
            if (host.Contains("myaccount.google.com")) return false;
            if (host.Contains("mail.google.com")) return false;
            if (host.Contains("drive.google.com")) return false;
            if (host.Contains("docs.google.com")) return false;
            if (host.Contains("youtube.com")) return false;
            if (host.Contains("play.google.com")) return false;
        }
        catch { /* fall through */ }

        return false;
    }

    /// <summary>Hosts used by captcha widgets (safe as top-level or frames).</summary>
    static bool IsCaptchaHelperHost(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return false;
        try
        {
            var host = new Uri(url).Host.ToLowerInvariant();
            if (host == "recaptcha.net" || host.EndsWith(".recaptcha.net")) return true;
            if (host.Contains("recaptcha")) return true;
            if (host.Contains("hcaptcha.com")) return true;
            if (host.Contains("challenges.cloudflare.com")) return true;
            if (host.EndsWith(".gstatic.com") || host == "gstatic.com") return true;
            if (host.EndsWith(".googleusercontent.com")) return true;
            if (host.EndsWith(".googleapis.com")) return true;
            return false;
        }
        catch
        {
            return false;
        }
    }

    void UpdateAuthOverlayFromUrl(string? url)
    {
        // Logout / about:blank cleanup must not start the sticky cover by itself
        if (IsGoogleLogoutUrl(url) || IsAboutBlank(url))
        {
            if (!_authLoginActive)
            {
                _onGoogleAuth = false;
                _captchaActive = false;
                ApplyAuthOverlayState();
                return;
            }
            // Mid-session logout as part of account switch — keep cover if already sticky
        }

        // Host-side URL check — lift cover immediately on /challenge/recaptcha (don't wait for inject)
        if (IsGoogleRecaptchaChallengeUrl(url))
        {
            _authLoginActive = true;
            _onGoogleAuth = true;
            _captchaActive = true;
            ApplyAuthOverlayState();
            return;
        }

        if (IsGoogleAuthRelatedUrl(url) && !IsGoogleLogoutUrl(url))
        {
            _authLoginActive = true;
            _onGoogleAuth = true;
            // Resume cover on normal sign-in steps after leaving /challenge/recaptcha
            if (IsGoogleCredentialStepUrl(url))
                _captchaActive = false;
            ApplyAuthOverlayState();
            return;
        }

        if (IsGoogleLogoutUrl(url) && _authLoginActive)
        {
            _onGoogleAuth = true;
            ApplyAuthOverlayState();
            return;
        }

        if (IsFlowWorkspaceUrl(url))
        {
            // Do NOT clear sticky cover on Flow URL alone — fresh-login bounce and
            // continue redirects flicker the overlay if we drop it here.
            // Cover ends only via HandleAuthOverlayCommand(done: true).
            if (_authLoginActive)
            {
                _onGoogleAuth = true;
                ApplyAuthOverlayState();
                return;
            }
            _onGoogleAuth = false;
            _captchaActive = false;
            ApplyAuthOverlayState();
            return;
        }

        // about:blank / blocked / other during sticky login — keep covering
        if (_authLoginActive)
        {
            _onGoogleAuth = true;
            ApplyAuthOverlayState();
            return;
        }

        _onGoogleAuth = false;
        _captchaActive = false;
        ApplyAuthOverlayState();
    }

    static bool IsAboutBlank(string? url) =>
        !string.IsNullOrWhiteSpace(url) &&
        url.StartsWith("about:", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Captcha / recaptcha URL — disable top-level nav lock so helper redirects can complete.
    /// (Background requests are never locked anywhere in the app.)
    /// </summary>
    static bool IsCaptchaUnlockUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return false;
        var u = url.ToLowerInvariant();
        return u.Contains("captcha")
               || u.Contains("recaptcha")
               || u.Contains("hcaptcha")
               || u.Contains("recaptcha.net")
               || u.Contains("challenges.cloudflare");
    }

    /// <summary>
    /// Top-level Google sign-in recaptcha challenge — user must interact; cover must lift.
    /// </summary>
    static bool IsGoogleRecaptchaChallengeUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return false;
        var u = url.ToLowerInvariant();
        if (u.Contains("recaptcha") || u.Contains("hcaptcha"))
            return true;
        // "captcha" alone — but not "captcha" inside unrelated strings on pwd pages
        if (u.Contains("/captcha") || u.Contains("captcha?") || u.Contains("captcha&") || u.Contains("captcha="))
            return true;
        if (u.Contains("challenge/recaptcha") || u.Contains("challenge/ipp") || u.Contains("challenge/az") ||
            u.Contains("challenge/bc") || u.Contains("challenge/wp"))
            return true;
        if (u.Contains("/challenge/") &&
            !u.Contains("/challenge/pwd") &&
            !u.Contains("/challenge/totp") &&
            !u.Contains("/challenge/selection") &&
            !u.Contains("/challenge/sk") &&
            !u.Contains("/challenge/iap") &&
            !u.Contains("/challenge/dp") &&
            !u.Contains("/challenge/ootp"))
            return true;
        return false;
    }

    /// <summary>Email / password / OTP steps where auto-login cover should be back on.</summary>
    static bool IsGoogleCredentialStepUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return false;
        try
        {
            var path = new Uri(url).AbsolutePath.ToLowerInvariant();
            return path.Contains("/identifier")
                   || path.Contains("/challenge/pwd")
                   || path.Contains("/challenge/totp")
                   || path.Contains("/challenge/ipp")
                   || path.Contains("/challenge/sk")
                   || path.Contains("/challenge/selection")
                   || path.Contains("/rejected")
                   || path.Contains("/speedbump");
        }
        catch
        {
            return false;
        }
    }

    static bool IsGoogleLogoutUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return false;
        try
        {
            var uri = new Uri(url);
            var host = uri.Host.ToLowerInvariant();
            var path = (uri.AbsolutePath ?? "").ToLowerInvariant();
            if (host.Contains("accounts.google.com") && path.Contains("logout"))
                return true;
            if ((host == "google.com" || host == "www.google.com") && path.StartsWith("/logout"))
                return true;
            return false;
        }
        catch
        {
            return url.Contains("logout", StringComparison.OrdinalIgnoreCase)
                   && url.Contains("google", StringComparison.OrdinalIgnoreCase);
        }
    }

    void HandleAuthOverlayCommand(bool show, bool captcha, bool done)
    {
        if (done)
        {
            // Ignore premature done while still on Google auth (reload / inject race)
            var cur = FlowView.CoreWebView2?.Source ?? "";
            if (IsGoogleAuthRelatedUrl(cur))
            {
                Debug.WriteLine("[AuthOverlay] ignore done — still on Google auth");
                _authLoginActive = true;
                _onGoogleAuth = true;
                if (IsGoogleRecaptchaChallengeUrl(cur))
                    _captchaActive = true;
                ApplyAuthOverlayState();
                return;
            }
            _captchaActive = false;
            _onGoogleAuth = false;
            _authLoginActive = false;
            ApplyAuthOverlayState();
            return;
        }
        if (captcha)
        {
            _captchaActive = true;
            _onGoogleAuth = true;
            _authLoginActive = true;
            ApplyAuthOverlayState();
            return;
        }
        // show / resume after captcha — never clear sticky session
        // But do not force cover back on while the URL is still a recaptcha challenge
        var live = FlowView.CoreWebView2?.Source ?? "";
        if (IsGoogleRecaptchaChallengeUrl(live))
        {
            _captchaActive = true;
            _onGoogleAuth = true;
            _authLoginActive = true;
            ApplyAuthOverlayState();
            return;
        }
        _captchaActive = false;
        _onGoogleAuth = true;
        _authLoginActive = true;
        ApplyAuthOverlayState();
    }

    void SyncOverlayMargins()
    {
        var top = _shellMode == "full" ? 0 : _chromeHeight;
        AuthOverlay.Margin = new Thickness(0, top, 0, 0);
        CaptchaBanner.Margin = new Thickness(0, top, 0, 0);
    }

    void ApplyAuthOverlayState()
    {
        Dispatcher.Invoke(() =>
        {
            SyncOverlayMargins();

            int want;
            if (_shellMode == "full" || WindowState == WindowState.Minimized)
                want = AuthUiOff;
            else if ((_authLoginActive || _onGoogleAuth) && _captchaActive)
                want = AuthUiCaptcha;
            else if (_authLoginActive || _onGoogleAuth)
                want = AuthUiCover;
            else
                want = AuthUiOff;

            // Idempotent — avoid Hide/Show flicker on every navigation tick
            if (want == _authUiMode)
            {
                if (want == AuthUiCover)
                {
                    SyncAuthCoverBounds();
                    PinAuthCoverAboveWebView();
                }
                return;
            }
            _authUiMode = want;

            if (want == AuthUiCaptcha)
            {
                AuthOverlay.Visibility = Visibility.Collapsed;
                CaptchaBanner.Visibility = Visibility.Visible;
                StopAuthCoverPinTimer();
                HideAuthCoverWindow();
                return;
            }

            if (want == AuthUiCover)
            {
                AuthOverlay.Visibility = Visibility.Visible;
                CaptchaBanner.Visibility = Visibility.Collapsed;
                ShowAuthCoverWindow();
                StartAuthCoverPinTimer();
                return;
            }

            AuthOverlay.Visibility = Visibility.Collapsed;
            CaptchaBanner.Visibility = Visibility.Collapsed;
            StopAuthCoverPinTimer();
            HideAuthCoverWindow();
        });
    }

    void StartAuthCoverPinTimer()
    {
        if (_authCoverPinTimer != null) return;
        _authCoverPinTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(80) };
        _authCoverPinTimer.Tick += (_, _) =>
        {
            if (_authUiMode != AuthUiCover) return;
            SyncAuthCoverBounds();
            PinAuthCoverAboveWebView();
        };
        _authCoverPinTimer.Start();
    }

    void StopAuthCoverPinTimer()
    {
        if (_authCoverPinTimer == null) return;
        _authCoverPinTimer.Stop();
        _authCoverPinTimer = null;
    }

    void PinAuthCoverAboveWebView()
    {
        if (_authCoverWindow == null || !_authCoverWindow.IsVisible) return;
        try
        {
            // Keep cover above WebView2 HWND during page reloads (airspace fights)
            if (IsActive)
                _authCoverWindow.Topmost = true;
            var hwnd = new WindowInteropHelper(_authCoverWindow).Handle;
            if (hwnd != IntPtr.Zero)
                SetWindowPos(hwnd, HwndaTop, 0, 0, 0, 0, SwpNomove | SwpNosize | SwpNoactivate);
        }
        catch { /* ignore */ }
    }

    void EnsureAuthCoverWindow()
    {
        if (_authCoverWindow != null) return;

        var spinBorder = new Border
        {
            Width = 52,
            Height = 52,
            CornerRadius = new CornerRadius(26),
            BorderBrush = new SolidColorBrush(Color.FromArgb(0x40, 0xCB, 0xD5, 0xE1)),
            BorderThickness = new Thickness(3),
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 18),
            RenderTransformOrigin = new Point(0.5, 0.5),
            Child = new System.Windows.Shapes.Ellipse
            {
                Width = 10,
                Height = 10,
                Fill = new SolidColorBrush(Color.FromRgb(0x38, 0xBD, 0xF8)),
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 2, 2, 0)
            }
        };
        var rotate = new RotateTransform();
        spinBorder.RenderTransform = rotate;
        var spinAnim = new DoubleAnimation(0, 360, new Duration(TimeSpan.FromSeconds(0.75)))
        {
            RepeatBehavior = RepeatBehavior.Forever
        };
        rotate.BeginAnimation(RotateTransform.AngleProperty, spinAnim);

        var panel = new StackPanel
        {
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            MaxWidth = 420
        };
        panel.Children.Add(spinBorder);
        panel.Children.Add(new TextBlock
        {
            Text = "Signing you in…",
            FontSize = 22,
            FontWeight = FontWeights.Bold,
            Foreground = new SolidColorBrush(Color.FromRgb(0xF8, 0xFA, 0xFC)),
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 8)
        });
        panel.Children.Add(new TextBlock
        {
            Text = "Automatic Google login is running. Please wait.",
            FontSize = 14,
            Foreground = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8)),
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center
        });

        // Opaque (no AllowsTransparency) — transparent covers flicker and show Google UI through
        _authCoverWindow = new Window
        {
            Owner = this,
            WindowStyle = WindowStyle.None,
            AllowsTransparency = false,
            Background = new SolidColorBrush(Color.FromRgb(0x02, 0x06, 0x17)),
            ShowInTaskbar = false,
            ResizeMode = ResizeMode.NoResize,
            ShowActivated = false,
            Focusable = false,
            Title = "FlowAuthCover",
            Content = panel,
            IsHitTestVisible = true
        };
    }

    void ShowAuthCoverWindow()
    {
        EnsureAuthCoverWindow();
        if (_authCoverWindow == null) return;
        if (!_authCoverWindow.IsVisible)
            _authCoverWindow.Show();
        SyncAuthCoverBounds();
        PinAuthCoverAboveWebView();
    }

    void HideAuthCoverWindow()
    {
        if (_authCoverWindow == null) return;
        _authCoverWindow.Topmost = false;
        if (_authCoverWindow.IsVisible)
            _authCoverWindow.Hide();
    }

    void SyncAuthCoverBounds()
    {
        if (_authCoverWindow == null || !_authCoverWindow.IsVisible) return;
        if (!IsVisible || WindowState == WindowState.Minimized) return;
        if (FlowView.Visibility != Visibility.Visible || FlowView.ActualWidth < 2 || FlowView.ActualHeight < 2)
            return;

        try
        {
            var topLeft = FlowView.PointToScreen(new Point(0, 0));
            var source = PresentationSource.FromVisual(this);
            if (source?.CompositionTarget != null)
            {
                var dip = source.CompositionTarget.TransformFromDevice.Transform(topLeft);
                _authCoverWindow.Left = dip.X;
                _authCoverWindow.Top = dip.Y;
            }
            else
            {
                _authCoverWindow.Left = topLeft.X;
                _authCoverWindow.Top = topLeft.Y;
            }
            _authCoverWindow.Width = Math.Max(2, FlowView.ActualWidth);
            _authCoverWindow.Height = Math.Max(2, FlowView.ActualHeight);
        }
        catch
        {
            /* layout not ready */
        }
    }

    /// <summary>
    /// Collapsed WebView2 aborts navigations (black about:blank page). Always show Flow first.
    /// </summary>
    async Task EnsureFlowReadyToNavigateAsync()
    {
        await Dispatcher.InvokeAsync(() =>
        {
            if (_shellMode == "full")
            {
                _shellMode = "chrome";
                FlowView.Visibility = Visibility.Visible;
                ShellView.Height = _chromeHeight;
                ShellView.VerticalAlignment = VerticalAlignment.Top;
                ShellView.Margin = new Thickness(0);
                FlowView.Margin = new Thickness(0, _chromeHeight, 0, 0);
                Panel.SetZIndex(ShellView, 10);
                Panel.SetZIndex(FlowView, 1);
                SyncOverlayMargins();
                ApplyAuthOverlayState();
            }
            else
            {
                FlowView.Visibility = Visibility.Visible;
                SyncAuthCoverBounds();
            }
        });
        await Task.Delay(60);
    }

    async Task NavigateFlowSafeAsync(string url)
    {
        try
        {
            await EnsureFlowReadyToNavigateAsync();
            await Dispatcher.InvokeAsync(() =>
            {
                if (FlowView.CoreWebView2 == null) return;
                FlowView.Visibility = Visibility.Visible;
                FlowView.CoreWebView2.Navigate(url);
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine("NavigateFlowSafe: " + ex.Message);
            PostToShell(new
            {
                type = "flow-event",
                @event = "did-fail-load",
                url,
                errorCode = -1,
                errorDescription = ex.Message
            });
        }
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
            // Never autofill / inject page overlays on recaptcha — blanks the challenge
            if (_captchaActive || IsGoogleRecaptchaChallengeUrl(u)) return;

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
        if (_captchaActive || IsGoogleRecaptchaChallengeUrl(src)) return;
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
  if (/recaptcha/i.test(path)) {{
    try {{ document.getElementById('__flow_host_ol__')?.remove(); }} catch (e) {{}}
    return {{ ok:false, reason:'recaptcha' }};
  }}
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
    // Never paint an in-page cover — host WPF overlay owns that (page cover blanked captcha)
    try {{ document.getElementById('__flow_host_ol__')?.remove(); }} catch (e) {{}}
    try {{ document.getElementById('__flow_host_ol_style__')?.remove(); }} catch (e) {{}}
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
      }}, 1500);
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
      }}, 1500);
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

        // Host owns the full-page Google auth cover (WebView2 HWND airspace)
        if (string.Equals(channel, "auth:captcha", StringComparison.OrdinalIgnoreCase) &&
            root.TryGetProperty("data", out var captchaData) &&
            captchaData.ValueKind == JsonValueKind.Object)
        {
            var active = captchaData.TryGetProperty("active", out var a) && a.ValueKind == JsonValueKind.True;
            HandleAuthOverlayCommand(show: !active, captcha: active, done: false);
        }
        else if (string.Equals(channel, "auth:auto-login", StringComparison.OrdinalIgnoreCase) &&
                 root.TryGetProperty("data", out var alData) &&
                 alData.ValueKind == JsonValueKind.Object)
        {
            var done = alData.TryGetProperty("done", out var doneEl) && doneEl.ValueKind == JsonValueKind.True;
            var captcha = alData.TryGetProperty("captcha", out var capEl) && capEl.ValueKind == JsonValueKind.True;
            var overlay = alData.TryGetProperty("overlay", out var ovEl) && ovEl.ValueKind == JsonValueKind.True;
            HandleAuthOverlayCommand(show: overlay || (!done && !captcha && _onGoogleAuth), captcha: captcha, done: done);
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
  }}, 1500);
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
                // Skip useless blank navigations — they abort the next real load on some devices
                if (string.Equals(url, "about:blank", StringComparison.OrdinalIgnoreCase))
                    break;
                _ = NavigateFlowSafeAsync(url);
                break;
            }
            case "chromeHeight":
            {
                var h = root.TryGetProperty("height", out var hv) ? hv.GetDouble() : ChromeHeight;
                if (h < 48) h = ChromeHeight;
                _chromeHeight = h;
                Dispatcher.Invoke(() =>
                {
                    if (_shellMode != "full")
                    {
                        ShellView.Height = _chromeHeight;
                        FlowView.Margin = new Thickness(0, _chromeHeight, 0, 0);
                        SyncOverlayMargins();
                        SyncAuthCoverBounds();
                    }
                });
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
            case "authOverlay":
            {
                var show = root.TryGetProperty("show", out var s) && s.ValueKind == JsonValueKind.True;
                var captcha = root.TryGetProperty("captcha", out var cEl) && cEl.ValueKind == JsonValueKind.True;
                var done = root.TryGetProperty("done", out var dEl) && dEl.ValueKind == JsonValueKind.True;
                HandleAuthOverlayCommand(show, captcha, done);
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
                return new
                {
                    serverUrl = string.IsNullOrWhiteSpace(_config.ServerUrl)
                        ? AppConfig.DefaultServerUrl
                        : _config.ServerUrl,
                    authToken = _config.AuthToken,
                    user = _config.User,
                    activeServer = _config.ActiveServer,
                    zoomLevel = _config.ZoomLevel
                };
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
        // Drop sticky Google auth cover immediately — wipe is not a sign-in session
        Dispatcher.Invoke(() =>
        {
            _captchaActive = false;
            _onGoogleAuth = false;
            _authLoginActive = false;
            ApplyAuthOverlayState();
        });

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
        }

        // Always try cookie wipe for Google / Flow hosts
        try
        {
            var hosts = new[]
            {
                "https://accounts.google.com",
                "https://flow.google.com",
                "https://labs.google",
                "https://www.google.com",
                "https://google.com",
                "https://myaccount.google.com",
                "https://oauth2.googleapis.com"
            };
            foreach (var host in hosts)
            {
                var cookies = await FlowView.CoreWebView2.CookieManager.GetCookiesAsync(host);
                foreach (var cookie in cookies)
                    FlowView.CoreWebView2.CookieManager.DeleteCookie(cookie);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine("ClearFlowCookies: " + ex.Message);
        }

        Dispatcher.Invoke(() =>
        {
            _captchaActive = false;
            _onGoogleAuth = false;
            _authLoginActive = false;
            ApplyAuthOverlayState();
        });
    }
}
