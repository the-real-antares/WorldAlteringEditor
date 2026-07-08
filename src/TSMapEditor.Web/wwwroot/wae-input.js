// Browser keyboard and clipboard bridge for WAE.
//
// 1. Forwards fully composed characters from DOM keydown events to the editor. The game
//    platform's own text input suppresses characters while a control or alt key is down,
//    which breaks AltGr combinations (e.g. the backslash on many European layouts) and
//    macOS Option compositions; e.key from the browser has the composed character.
// 2. Suppresses browser default actions for shortcuts the editor uses (Ctrl+S saves the
//    page, '/' opens quick find in Firefox, Alt focuses the menu bar, ...), while keeping
//    reload, fullscreen, devtools and paste usable.
// 3. Synchronizes the operating system clipboard with the editor: the DOM paste event
//    (which needs no permission prompt) pushes text in, and copies from the editor are
//    written out through the asynchronous clipboard API.

(function () {
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform);

    // Events targeting real DOM form controls (e.g. the folder-picker fallback overlay)
    // belong to the browser, not the game.
    function isDomFormTarget(e) {
        var t = e.target;
        return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLButtonElement;
    }

    function allowBrowserDefault(e) {
        var mod = e.ctrlKey || e.metaKey;
        if (e.code === 'F5' || e.code === 'F11' || e.code === 'F12')
            return true;                                                     // reload, fullscreen, devtools
        if (mod && !e.shiftKey && !e.altKey && e.code === 'KeyR')
            return true;                                                     // reload
        if (mod && e.shiftKey && /^Key[IJC]$/.test(e.code))
            return true;                                                     // devtools panes
        if (isMac && e.metaKey && e.altKey && /^Key[IJC]$/.test(e.code))
            return true;                                                     // macOS devtools
        if (mod && !e.shiftKey && !e.altKey && e.code === 'KeyV')
            return true;                                                     // must pass so the paste event fires
        return false;
    }

    window.addEventListener('keydown', function (e) {
        if (isDomFormTarget(e))
            return;

        // Character channel: composed printable characters only (e.key is 'a', '\\', '~', ...
        // for text; 'Enter', 'Backspace', ... for specials, which the key channel handles).
        if (window.theInstance && e.key && e.key.length === 1 && !e.metaKey) {
            var altGraph = e.getModifierState && e.getModifierState('AltGraph');
            var ctrlBlocked = e.ctrlKey && !altGraph;          // plain Ctrl+letter is a shortcut, not text
            var altBlocked = e.altKey && !altGraph && !isMac;  // macOS Option composes real characters
            if (!ctrlBlocked && !altBlocked)
                window.theInstance.invokeMethod('OnBrowserCharInput', e.key);
        }

        if (!allowBrowserDefault(e))
            e.preventDefault();
    }, true); // capture phase; preventDefault does not stop the game platform's own listener

    window.addEventListener('keyup', function (e) {
        // Firefox activates the menu bar when Alt is released.
        if (e.key === 'Alt' && !isDomFormTarget(e))
            e.preventDefault();
    }, true);

    // OS clipboard -> editor. Fires because Ctrl/Cmd+V keydown is allowlisted above;
    // clipboardData.getData is synchronous and prompt-free in all browsers.
    window.addEventListener('paste', function (e) {
        if (!window.theInstance || isDomFormTarget(e))
            return;
        var text = (e.clipboardData || window.clipboardData).getData('text');
        if (typeof text === 'string')
            window.theInstance.invokeMethod('OnBrowserClipboardText', text);
        e.preventDefault();
    });

    // Editor -> OS clipboard, on copy/cut in the editor. Fire-and-forget; requires a
    // secure context (https), silently unavailable otherwise.
    window.waeClipboardWrite = function (text) {
        if (navigator.clipboard && navigator.clipboard.writeText)
            navigator.clipboard.writeText(text).catch(function () { });
    };
})();
