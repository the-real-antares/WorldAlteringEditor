using System;
using System.Threading.Tasks;

namespace TSMapEditor.Misc
{
    /// <summary>
    /// Bridge for browser-based file access. On the web build the Blazor host assigns these
    /// delegates at startup; on the desktop build they stay null and the native WinForms
    /// dialogs are used instead.
    /// </summary>
    public static class WebFileAccess
    {
        /// <summary>
        /// Opens a browser folder picker, loads the chosen game directory into the virtual
        /// filesystem, and returns its virtual path (empty string on cancel/failure).
        /// Null when not running in the browser.
        /// </summary>
        public static Func<Task<string>> PickGameDirectoryAsync;

        public static bool IsAvailable => PickGameDirectoryAsync != null;
    }
}
