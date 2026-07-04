using System;
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

            try
            {
                byte[] bytes = await Http.GetByteArrayAsync("waeassets.zip");
                using var ms = new System.IO.MemoryStream(bytes);
                using var zip = new System.IO.Compression.ZipArchive(ms, System.IO.Compression.ZipArchiveMode.Read);
                foreach (var entry in zip.Entries)
                {
                    if (string.IsNullOrEmpty(entry.Name))
                        continue; // directory entry

                    string destPath = "/" + entry.FullName;
                    string dir = System.IO.Path.GetDirectoryName(destPath);
                    if (!string.IsNullOrEmpty(dir))
                        System.IO.Directory.CreateDirectory(dir);

                    using var es = entry.Open();
                    using var fs = System.IO.File.Create(destPath);
                    await es.CopyToAsync(fs);
                }
                _assetsReady = true;
            }
            catch (Exception ex)
            {
                Console.WriteLine("Failed to extract editor assets into the virtual filesystem: " + ex);
            }
        }

        protected override void OnAfterRender(bool firstRender)
        {
            base.OnAfterRender(firstRender);

            if (firstRender)
            {
                JsRuntime.InvokeAsync<object>("initRenderJS", DotNetObjectReference.Create(this));
            }
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
