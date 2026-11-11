using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Diagnostics;
using System.Threading;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Shiye {
    static class Program {
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string className, string windowName);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
        [STAThread]
        static void Main(string[] args) {
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string profile = Environment.GetEnvironmentVariable("SHIYE_PROFILE");
            if (String.IsNullOrWhiteSpace(profile)) profile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Data");
            string key;
            using (var hash = SHA256.Create()) key = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(profile).ToUpperInvariant()))).Replace("-", "");
            bool created;
            using (var mutex = new Mutex(true, "Local\\ShiyeReader-" + key, out created)) {
                if (!created) {
                    IntPtr window = FindWindow(null, "拾页");
                    if (window != IntPtr.Zero) { ShowWindow(window, 9); SetForegroundWindow(window); }
                    return;
                }
                Application.Run(new ReaderWindow(args));
                mutex.ReleaseMutex();
            }
        }
    }

    sealed class ReaderWindow : Form {
        readonly WebView2 browser = new WebView2();
        readonly string[] arguments;
        FormWindowState savedState;
        Rectangle savedBounds;
        bool fullscreen;
        bool readyToClose;
        readonly System.Windows.Forms.Timer closeTimer = new System.Windows.Forms.Timer { Interval = 1800 };

        public ReaderWindow(string[] args) {
            arguments = args;
            Text = "拾页";
            ClientSize = new Size(1220, 800);
            MinimumSize = new Size(760, 540);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(250, 251, 249);
            string iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "拾页.ico");
            if (File.Exists(iconPath)) Icon = new Icon(iconPath);
            browser.Dock = DockStyle.Fill;
            browser.DefaultBackgroundColor = BackColor;
            Controls.Add(browser);
            closeTimer.Tick += (sender, ev) => { closeTimer.Stop(); readyToClose = true; Close(); };
            FormClosing += (sender, ev) => {
                if (readyToClose || browser.CoreWebView2 == null) return;
                ev.Cancel = true;
                browser.CoreWebView2.PostWebMessageAsJson("{\"type\":\"closing\"}");
                closeTimer.Start();
            };
            Shown += async (sender, ev) => {
                try {
                    string profile = Environment.GetEnvironmentVariable("SHIYE_PROFILE");
                    if (String.IsNullOrWhiteSpace(profile)) profile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Data");
                    string temporary = Path.Combine(profile, "Temp");
                    Directory.CreateDirectory(temporary);
                    Environment.SetEnvironmentVariable("TEMP", temporary);
                    Environment.SetEnvironmentVariable("TMP", temporary);
                    var options = new CoreWebView2EnvironmentOptions();
                    if (arguments.Contains("--debug")) options.AdditionalBrowserArguments = "--remote-debugging-port=9223";
                    var environment = await CoreWebView2Environment.CreateAsync(null, profile, options);
                    await browser.EnsureCoreWebView2Async(environment);
                    var core = browser.CoreWebView2;
                    core.SetVirtualHostNameToFolderMapping("shiye.local", Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app"), CoreWebView2HostResourceAccessKind.DenyCors);
                    core.Settings.AreDevToolsEnabled = arguments.Contains("--debug");
                    core.Settings.IsStatusBarEnabled = false;
                    core.Settings.AreBrowserAcceleratorKeysEnabled = false;
                    core.Settings.IsGeneralAutofillEnabled = false;
                    core.Settings.IsPasswordAutosaveEnabled = false;
                    core.Settings.AreDefaultContextMenusEnabled = true;
                    core.Settings.IsZoomControlEnabled = false;
                    core.PermissionRequested += (s, e) => { e.State = CoreWebView2PermissionState.Deny; };
                    core.NavigationStarting += (s, e) => {
                        Uri uri;
                        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out uri) && uri.Host != "shiye.local" && uri.Scheme != "blob" && uri.Scheme != "about") {
                            e.Cancel = true;
                            if (uri.Scheme == "https" || uri.Scheme == "http") OpenLink(e.Uri);
                        }
                    };
                    core.NewWindowRequested += (s, e) => {
                        e.Handled = true;
                        Uri uri;
                        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out uri) && (uri.Scheme == "https" || uri.Scheme == "http")) OpenLink(e.Uri);
                    };
                    core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
                    core.WebResourceRequested += (s, e) => {
                        Uri uri;
                        if (Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out uri) && (uri.Scheme == "https" || uri.Scheme == "http") && uri.Host != "shiye.local") {
                            e.Response = environment.CreateWebResourceResponse(null, 403, "Local reading only", "Content-Type: text/plain");
                        }
                    };
                    core.WebMessageReceived += (s, e) => {
                        if (!e.Source.StartsWith("https://shiye.local/")) return;
                        if (e.WebMessageAsJson.Contains("\"fullscreen\"")) ToggleFullscreen();
                        if (e.WebMessageAsJson.Contains("\"flushed\"")) { closeTimer.Stop(); readyToClose = true; Close(); }
                    };
                    core.DownloadStarting += (s, e) => {
                        e.Handled = true;
                        using (var save = new SaveFileDialog()) {
                            save.FileName = Path.GetFileName(e.ResultFilePath);
                            save.InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
                            save.Filter = "所有文件 (*.*)|*.*";
                            if (save.ShowDialog(this) == DialogResult.OK) e.ResultFilePath = save.FileName;
                            else e.Cancel = true;
                        }
                    };
                    browser.Source = new Uri("https://shiye.local/index.html");
                } catch (WebView2RuntimeNotFoundException) {
                    MessageBox.Show(this, "拾页需要 Microsoft Edge WebView2 运行时。请安装微软的 WebView2 Evergreen Runtime 后重新打开。\n\nhttps://developer.microsoft.com/microsoft-edge/webview2/", "运行组件缺失", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    Close();
                } catch (Exception error) {
                    MessageBox.Show(this, "拾页启动失败。\n\n" + error.Message, "拾页", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    Close();
                }
            };
        }

        void OpenLink(string url) {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
        }

        void ToggleFullscreen() {
            if (!fullscreen) {
                savedState = WindowState;
                savedBounds = Bounds;
                WindowState = FormWindowState.Normal;
                FormBorderStyle = FormBorderStyle.None;
                Bounds = Screen.FromControl(this).Bounds;
            } else {
                FormBorderStyle = FormBorderStyle.Sizable;
                Bounds = savedBounds;
                WindowState = savedState;
            }
            fullscreen = !fullscreen;
        }
    }
}
