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

        /// <summary>
        /// Leaves the editor page. The browser platform does not allow programmatically
        /// closing the game, so exiting means navigating away from or reloading the page.
        /// Null when not running in the browser.
        /// </summary>
        public static Action ExitPage;

        /// <summary>
        /// Additional game executable names accepted when validating the game directory,
        /// supplied through the page URL so that modified games can be loaded without
        /// editing the editor's configuration files. Null when not set.
        /// </summary>
        public static string[] AdditionalExecutableNames;

        public static bool IsAvailable => PickGameDirectoryAsync != null;
    }
}
