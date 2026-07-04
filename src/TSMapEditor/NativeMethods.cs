using System;
using System.Runtime.InteropServices;

namespace TSMapEditor
{
    public static class NativeMethods
    {
#if WINDOWS
        [DllImport("gdi32.dll")]
        private static extern int GetDeviceCaps(IntPtr hdc, int nIndex);

        [DllImport("user32.dll")]
        private static extern IntPtr GetDC(IntPtr hWnd);

        /// <summary>
        /// Logical pixels inch in X
        /// </summary>
        private const int LOGPIXELSX = 88;

        /// <summary>
        /// Logical pixels inch in Y
        /// </summary>
        private const int LOGPIXELSY = 90;


        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AllocConsole();

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FreeConsole();


        public static int GetScreenDPI()
        {
            // This function currently only works on Windows
            IntPtr hdc = GetDC(IntPtr.Zero);
            return GetDeviceCaps(hdc, LOGPIXELSX);
        }

        public static void CreateConsole()
        {
            AllocConsole();
        }

        public static void DisableConsole()
        {
            FreeConsole();
        }
#else
        // Non-Windows (e.g. browser) builds have no Win32 GDI/console APIs.
        // 96 is the standard baseline DPI; browsers apply their own devicePixelRatio.
        public static int GetScreenDPI() => 96;

        public static void CreateConsole() { }

        public static void DisableConsole() { }
#endif
    }
}
