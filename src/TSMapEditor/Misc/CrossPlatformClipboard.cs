using System.Collections.Generic;

namespace TSMapEditor.Misc
{
    /// <summary>
    /// Named-format clipboard access that works on both the Windows desktop build
    /// (backed by the system clipboard) and non-Windows builds such as the browser
    /// (backed by an in-memory, per-session store). The map editor only ever copies
    /// its own custom binary/string formats between its own windows, so an in-memory
    /// store is sufficient where the OS clipboard is unavailable.
    /// </summary>
    public static class CrossPlatformClipboard
    {
#if WINDOWS
        public static void SetData(string format, object data)
            => System.Windows.Forms.Clipboard.SetData(format, data);

        public static object GetData(string format)
            => System.Windows.Forms.Clipboard.GetData(format);

        public static bool ContainsData(string format)
            => System.Windows.Forms.Clipboard.ContainsData(format);
#else
        private static readonly Dictionary<string, object> store = new Dictionary<string, object>();

        public static void SetData(string format, object data)
            => store[format] = data;

        public static object GetData(string format)
            => store.TryGetValue(format, out var value) ? value : null;

        public static bool ContainsData(string format)
            => store.ContainsKey(format);
#endif
    }
}
