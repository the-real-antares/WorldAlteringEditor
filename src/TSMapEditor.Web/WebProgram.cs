using System;

namespace TSMapEditor
{
    /// <summary>
    /// Browser-build replacement for the desktop <c>Program</c> entry point (whose WinForms
    /// bootstrap is excluded from the web build). Provides the few static members that the rest
    /// of the editor references. The actual entry point is the Blazor host (see Program.cs).
    /// </summary>
    static class Program
    {
        public static string[] args = Array.Empty<string>();

        public static void DisableExceptionHandler()
        {
            // No WinForms unhandled-exception handler to disable in the browser.
        }
    }
}
