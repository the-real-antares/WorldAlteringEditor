using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.JSInterop;
using Microsoft.Xna.Framework;

namespace TSMapEditor.Web.Pages
{
    public partial class Index
    {
        Game _game;
        bool _assetsReady;

        // Extract the bundled Config/** and Content/** tree into the WASM in-memory filesystem
        // so the editor's synchronous System.IO reads (rooted at CurrentDirectory "/") resolve.
        protected override async Task OnInitializedAsync()
        {
            // Wire the browser file-access bridge the editor calls from its Browse buttons.
            TSMapEditor.Misc.WebFileAccess.PickGameDirectoryAsync =
                () => JsRuntime.InvokeAsync<string>("waeLoadGameDirectory").AsTask();

            // The browser platform cannot programmatically close the game; exiting reloads the page.
            TSMapEditor.Misc.WebFileAccess.ExitPage =
                () => JsRuntime.InvokeVoidAsync("waeReloadPage");

            // Saved maps land in the virtual filesystem; export them to the user's disk.
            TSMapEditor.Misc.WebFileAccess.ExportMapFile =
                path => JsRuntime.InvokeVoidAsync("waeExportMapFile", path);

            // Accept additional game executable names from the URL (e.g. ?exe=mymod.exe) so
            // modified games can be loaded without editing the editor's configuration.
            // Requesting server-hosted game files loads the game directory automatically,
            // without the user needing to press Browse first (the download needs no gesture).
            if (GetQueryValue("files") == "hosted")
                TSMapEditor.Misc.WebFileAccess.AutoLoadGameDirectory = true;

            string exeOverride = GetQueryValue("exe");
            if (!string.IsNullOrEmpty(exeOverride))
            {
                TSMapEditor.Misc.WebFileAccess.AdditionalExecutableNames = exeOverride
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Where(name => name.IndexOfAny(new[] { '/', '\\' }) < 0 && name.Length <= 64)
                    .ToArray();
            }

            try
            {
                byte[] bytes = await Http.GetByteArrayAsync(GetAssetBundleSource());
                using var ms = new System.IO.MemoryStream(bytes);
                using var zip = new System.IO.Compression.ZipArchive(ms, System.IO.Compression.ZipArchiveMode.Read);
                foreach (var entry in zip.Entries)
                {
                    if (string.IsNullOrEmpty(entry.Name))
                        continue; // directory entry

                    // Guard against path traversal in externally supplied bundles.
                    if (entry.FullName.Contains(".."))
                        continue;

                    string destPath = "/" + entry.FullName;
                    string dir = System.IO.Path.GetDirectoryName(destPath);
                    if (!string.IsNullOrEmpty(dir))
                        System.IO.Directory.CreateDirectory(dir);

                    using var es = entry.Open();
                    using var fs = System.IO.File.Create(destPath);
                    await es.CopyToAsync(fs);
                }

                await DownloadMapFromUrl();
                _assetsReady = true;
            }
            catch (Exception ex)
            {
                Console.WriteLine("Failed to extract editor assets into the virtual filesystem: " + ex);
            }
        }

        /// <summary>
        /// Downloads a map given through the map query parameter into the virtual filesystem,
        /// to be opened automatically once the game directory has been selected. Mind that the
        /// hosting server must allow cross-origin requests for external URLs to be fetchable.
        /// </summary>
        private async Task DownloadMapFromUrl()
        {
            string mapUrl = GetQueryValue("map");
            if (string.IsNullOrEmpty(mapUrl) || !IsSafeUrl(mapUrl))
                return;

            try
            {
                byte[] mapBytes = await Http.GetByteArrayAsync(mapUrl);

                string name = mapUrl.Split('?')[0].Split('#')[0].Split('/')[^1];
                name = string.Concat(name.Where(c => char.IsLetterOrDigit(c) || c is '.' or '-' or '_'));
                string extension = System.IO.Path.GetExtension(name).ToLowerInvariant();
                if (extension != ".map" && extension != ".mpr" && extension != ".yrm")
                    name = "imported.map";

                string virtualPath = "/" + name;
                System.IO.File.WriteAllBytes(virtualPath, mapBytes);
                TSMapEditor.Misc.WebFileAccess.PendingMapPath = virtualPath;
            }
            catch (Exception ex)
            {
                Console.WriteLine("Failed to download the map given through the page URL: " + ex);
            }
        }

        /// <summary>
        /// Accepts same-origin relative paths and absolute https URLs
        /// (but not protocol-relative //host paths).
        /// </summary>
        private static bool IsSafeUrl(string url) =>
            (url.StartsWith('/') && !url.StartsWith("//")) ||
            (Uri.TryCreate(url, UriKind.Absolute, out Uri parsed) && parsed.Scheme == Uri.UriSchemeHttps);

        /// <summary>
        /// Resolves which editor configuration bundle to load. The build bundles the configuration
        /// of its own branch as waeassets.zip; a deployment can also host bundles for the other
        /// supported games (waeassets-dta.zip, waeassets-ts.zip, waeassets-yr.zip) and select one
        /// with a game query parameter, e.g. ?game=dta. A config query parameter can point at an
        /// externally hosted bundle (over https, from a host that allows cross-origin requests)
        /// so that modified games can supply their own editor configuration.
        /// </summary>
        private string GetAssetBundleSource()
        {
            string configUrl = GetQueryValue("config");
            if (!string.IsNullOrEmpty(configUrl) && IsSafeUrl(configUrl))
                return configUrl;

            string game = GetQueryValue("game")?.ToLowerInvariant();
            if (!string.IsNullOrEmpty(game) && game.Length <= 16 && game.All(char.IsLetterOrDigit))
                return $"waeassets-{game}.zip";

            return "waeassets.zip";
        }

        /// <summary>
        /// Returns the value of a query parameter of the page URL, or null when not present.
        /// </summary>
        private string GetQueryValue(string name)
        {
            var query = new Uri(Navigation.Uri).Query;
            if (string.IsNullOrEmpty(query))
                return null;

            foreach (string pair in query.TrimStart('?').Split('&'))
            {
                string[] parts = pair.Split('=');
                if (parts.Length == 2 && parts[0] == name)
                    return Uri.UnescapeDataString(parts[1]);
            }

            return null;
        }

        protected override void OnAfterRender(bool firstRender)
        {
            base.OnAfterRender(firstRender);

            if (firstRender)
            {
                JsRuntime.InvokeAsync<object>("initRenderJS", DotNetObjectReference.Create(this));

                // Forward text copied inside the editor to the browser clipboard.
                Rampastring.XNAUI.RClipboard.TextSet +=
                    text => JsRuntime.InvokeVoidAsync("waeClipboardWrite", text);
            }
        }

        /// <summary>
        /// Receives composed characters from the page's keydown handler. This channel delivers
        /// characters that the game platform's text input suppresses, such as AltGr combinations.
        /// </summary>
        [JSInvokable]
        public void OnBrowserCharInput(string text)
        {
            if (_game == null || string.IsNullOrEmpty(text))
                return;

            foreach (char character in text)
                Rampastring.XNAUI.Input.KeyboardEventInput.TriggerCharEntered(character);
        }

        /// <summary>
        /// Receives the operating system clipboard contents from the page's paste handler,
        /// ahead of the editor processing the paste keypress.
        /// </summary>
        [JSInvokable]
        public void OnBrowserClipboardText(string text)
        {
            Rampastring.XNAUI.RClipboard.UpdateFromHost(text);
        }

        private bool _failed;

        [JSInvokable]
        public void TickDotNet()
        {
            if (_failed || !_assetsReady)
                return;

            try
            {
                // init game
                if (_game == null)
                {
                    _game = new TSMapEditor.Rendering.GameClass();
                    _game.Run();
                }

                // run gameloop
                _game.Tick();
            }
            catch (Exception ex)
            {
                _failed = true;
                Console.WriteLine("The map editor has crashed: " + ex);
            }
        }

    }
}
