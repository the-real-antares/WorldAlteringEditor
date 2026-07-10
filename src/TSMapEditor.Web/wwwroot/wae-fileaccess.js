// Browser game-file access for WAE. Uses the File System Access API to let the user pick
// their game folder, then writes the relevant files into the .NET WASM virtual filesystem
// (Emscripten MEMFS) so the editor's synchronous file IO can read them unchanged.

// Only load file types the editor actually needs, to keep memory bounded (skip movies/audio).
const WAE_ALLOWED_EXT = new Set([
  'mix', 'ini', 'map', 'mpr', 'yrm', 'csf', 'pal', 'shp', 'vxl', 'hva',
  'tmp', 'pcx', 'fnt', 'vpl', 'exe', ''
]);

// Leaving the editor in the browser means reloading the page (back to the start screen).
window.waeReloadPage = () => window.location.reload();

// Exports a map file saved into the virtual filesystem to the user's real filesystem.
// Chromium: a save dialog on the first save, silent writes to the same file afterwards.
// Other browsers: a regular download per save.
const waeSaveHandles = new Map();

window.waeExportMapFile = async (path) => {
  let bytes;
  try {
    bytes = waeFS().readFile(path);
  } catch (e) {
    console.error('WAE: cannot read saved map from virtual filesystem: ' + e);
    return;
  }
  const fileName = path.split('/').pop();

  if (window.showSaveFilePicker) {
    try {
      let handle = waeSaveHandles.get(path);
      if (!handle) {
        handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'Map files', accept: { 'text/plain': ['.map', '.mpr', '.yrm', '.ini'] } }],
        });
        waeSaveHandles.set(path, handle);
      }
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return;
    } catch (e) {
      if (e && e.name === 'AbortError')
        return; // user cancelled the save dialog
      console.error('WAE: save dialog export failed, falling back to download: ' + e);
      waeSaveHandles.delete(path);
    }
  }

  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

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

// Removes any previously loaded game directory and recreates it empty, so picking a
// different folder never mixes files from two installs. MEMFS paths are plain directories,
// not mounts, so this has to be a recursive delete.
function waeResetGameDir(FS, dir) {
  function rmTree(path) {
    let entries;
    try { entries = FS.readdir(path); } catch (e) { return; }
    for (const name of entries) {
      if (name === '.' || name === '..')
        continue;
      const p = path + '/' + name;
      if (FS.isDir(FS.stat(p).mode))
        rmTree(p);
      else
        FS.unlink(p);
    }
    FS.rmdir(path);
  }
  rmTree(dir);
  FS.mkdirTree(dir);
}

// Recursively write a picked directory (File System Access API) into MEMFS under `dir`.
// Returns files written.
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

// Writes files picked through an <input type=file webkitdirectory> into MEMFS under `dir`.
// webkitRelativePath is "PickedFolder/sub/file.ext"; the first segment is stripped.
async function waeWriteInputFiles(FS, files, dir) {
  let count = 0;
  for (const file of files) {
    const rel = (file.webkitRelativePath || file.name).split('/').slice(1).join('/') || file.name;
    const name = rel.split('/').pop();
    if (!WAE_ALLOWED_EXT.has(waeExt(name)))
      continue;
    if (waeSkip(name)) {
      console.log('WAE: skipping large unused archive ' + name);
      continue;
    }
    const p = dir + '/' + rel;
    const parent = p.slice(0, p.lastIndexOf('/'));
    try { FS.mkdirTree(parent); } catch (e) { /* exists */ }
    const buf = new Uint8Array(await file.arrayBuffer());
    FS.writeFile(p, buf);
    count++;
  }
  return count;
}

// Folder-picker fallback for browsers without the File System Access API (Firefox, Safari):
// a hidden <input type=file webkitdirectory>. Resolves to a FileList or null on cancel.
function waePickViaInput() {
  let input = document.getElementById('waeDirInput');
  if (!input) {
    input = document.createElement('input');
    input.id = 'waeDirInput';
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
  }
  return new Promise(resolve => {
    input.value = '';
    input.onchange = () => resolve(input.files && input.files.length ? input.files : null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// Downloads server-hosted game files (freeware games only) into MEMFS under `dir`.
// The manifest lists files as { path, size, parts? }; parts are URL suffixes relative
// to the manifest directory, used to split files past CDN single-file size limits.
async function waeDownloadHostedFiles(FS, game, dir) {
  const base = 'gamefiles/' + game + '/';
  const manifestResponse = await fetch(base + 'manifest.json', { cache: 'no-cache' });
  if (!manifestResponse.ok)
    throw new Error('no hosted files for "' + game + '" (HTTP ' + manifestResponse.status + ')');
  const manifest = await manifestResponse.json();

  waeResetGameDir(FS, dir);
  const totalBytes = manifest.files.reduce((n, f) => n + (f.size || 0), 0);
  let doneBytes = 0;
  let count = 0;

  // A few files in flight at a time: keeps the pipe full without holding
  // too many decoded buffers in memory at once.
  const queue = manifest.files.slice();
  async function worker() {
    for (;;) {
      const entry = queue.shift();
      if (!entry)
        return;
      const parts = entry.parts || [entry.path];
      const buffers = [];
      for (const part of parts) {
        const response = await fetch(base + part);
        if (!response.ok)
          throw new Error('failed to fetch ' + part + ' (HTTP ' + response.status + ')');
        buffers.push(new Uint8Array(await response.arrayBuffer()));
      }
      const total = buffers.reduce((n, b) => n + b.length, 0);
      let merged;
      if (buffers.length === 1) {
        merged = buffers[0];
      } else {
        merged = new Uint8Array(total);
        let offset = 0;
        for (const b of buffers) { merged.set(b, offset); offset += b.length; }
      }
      const p = dir + '/' + entry.path;
      const parent = p.slice(0, p.lastIndexOf('/'));
      if (parent !== dir)
        try { FS.mkdirTree(parent); } catch (e) { /* exists */ }
      FS.writeFile(p, merged);
      count++;
      doneBytes += total;
      if (totalBytes > 0)
        document.title = 'World-Altering Editor - downloading game files ' + Math.round(100 * doneBytes / totalBytes) + '%';
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  document.title = 'World-Altering Editor';
  return count;
}

// Opens the folder picker, loads the chosen game directory into MEMFS at `/game`.
// With ?files=hosted in the page URL, downloads the server-hosted freeware game files
// instead, so no local game installation is needed.
// Returns the virtual path on success, or an empty string on cancel/error.
window.waeLoadGameDirectory = async () => {
  try {
    const FS = waeFS();
    const params = new URLSearchParams(window.location.search);
    let count;

    if (params.get('files') === 'hosted') {
      const game = (params.get('game') || 'yr').toLowerCase();
      try {
        count = await waeDownloadHostedFiles(FS, game, '/game');
        console.log('WAE: loaded ' + count + ' game files into /game');
        return '/game';
      } catch (e) {
        // No hosted set for this game (or the download failed): tell the user and
        // fall through to the regular folder picker so Browse still works.
        console.error('WAE: hosted game files unavailable: ' + e);
        alert('Hosted game files are not available for "' + game + '" (' + e.message + ').\n\nPick your local game folder instead.');
      }
    }

    if (window.showDirectoryPicker) {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
      waeResetGameDir(FS, '/game');
      count = await waeWalkAndWrite(FS, dirHandle, '/game');
    } else {
      const files = await waePickViaInput();
      if (!files)
        return '';
      waeResetGameDir(FS, '/game');
      count = await waeWriteInputFiles(FS, files, '/game');
    }

    console.log('WAE: loaded ' + count + ' game files into /game');
    return '/game';
  } catch (e) {
    console.error('WAE: game directory load failed: ' + e);
    return '';
  }
};
