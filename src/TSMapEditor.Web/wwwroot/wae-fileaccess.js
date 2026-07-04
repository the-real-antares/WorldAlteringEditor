// Browser game-file access for WAE. Uses the File System Access API to let the user pick
// their game folder, then writes the relevant files into the .NET WASM virtual filesystem
// (Emscripten MEMFS) so the editor's synchronous file IO can read them unchanged.

// Only load file types the editor actually needs, to keep memory bounded (skip movies/audio).
const WAE_ALLOWED_EXT = new Set([
  'mix', 'ini', 'map', 'mpr', 'yrm', 'csf', 'pal', 'shp', 'vxl', 'hva',
  'tmp', 'pcx', 'fnt', 'vpl', 'exe', ''
]);

function waeExt(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

// Huge MIX archives the map editor never needs (cutscene video, music). Loading these into
// WASM memory would blow the heap, so skip them by name.
const WAE_SKIP_MIX = [/^movies/i, /^movmd/i, /^theme/i, /^thememd/i, /^scores/i];

function waeSkip(name) {
  const lower = name.toLowerCase();
  return lower.endsWith('.mix') && WAE_SKIP_MIX.some(re => re.test(name));
}

function waeFS() {
  // .NET 8 exposes the runtime; its Emscripten Module.FS is the virtual filesystem.
  const rt = globalThis.getDotnetRuntime && globalThis.getDotnetRuntime(0);
  if (!rt || !rt.Module || !rt.Module.FS)
    throw new Error('dotnet runtime FS not available');
  return rt.Module.FS;
}

// Recursively write a picked directory into MEMFS under `root`. Returns files written.
async function waeWalkAndWrite(FS, handle, dir) {
  try { FS.mkdirTree(dir); } catch (e) { /* exists */ }
  let count = 0;
  for await (const entry of handle.values()) {
    const p = dir + '/' + entry.name;
    if (entry.kind === 'directory') {
      count += await waeWalkAndWrite(FS, entry, p);
    } else if (entry.kind === 'file') {
      if (!WAE_ALLOWED_EXT.has(waeExt(entry.name)))
        continue;
      if (waeSkip(entry.name)) {
        console.log('WAE: skipping large unused archive ' + entry.name);
        continue;
      }
      const file = await entry.getFile();
      const buf = new Uint8Array(await file.arrayBuffer());
      FS.writeFile(p, buf);
      count++;
    }
  }
  return count;
}

// Opens the folder picker, loads the chosen game directory into MEMFS at `/game`.
// Returns the virtual path on success, or an empty string on cancel/error.
window.waeLoadGameDirectory = async () => {
  if (!window.showDirectoryPicker) {
    console.error('WAE: showDirectoryPicker not supported in this browser (Chromium required).');
    return '';
  }
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    const FS = waeFS();
    // Fresh mount each time.
    try { FS.unmount && FS.unmount('/game'); } catch (e) { /* ignore */ }
    const count = await waeWalkAndWrite(FS, dirHandle, '/game');
    console.log('WAE: loaded ' + count + ' game files into /game');
    return '/game';
  } catch (e) {
    console.error('WAE: game directory load failed: ' + e);
    return '';
  }
};
