const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function escapeForPowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

async function recycleOneWindows(resolved) {
  const isDir = fs.statSync(resolved).isDirectory();
  const escaped = escapeForPowerShellSingleQuoted(resolved);
  const method = isDir ? 'DeleteDirectory' : 'DeleteFile';
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::${method}('${escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin')
`;

  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, maxBuffer: 1024 * 1024 }
    );
    return { path: resolved, ok: true };
  } catch (err) {
    return {
      path: resolved,
      ok: false,
      error: err.stderr?.toString?.() || err.message || String(err),
    };
  }
}

async function recycleOneMac(resolved) {
  // Finder "delete" moves to Trash
  const posix = resolved.replace(/\\/g, '/');
  const escaped = posix.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  try {
    await execFileAsync('osascript', [
      '-e',
      `tell application "Finder" to delete (POSIX file "${escaped}" as alias)`,
    ]);
    return { path: resolved, ok: true };
  } catch (err) {
    return {
      path: resolved,
      ok: false,
      error: err.stderr?.toString?.() || err.message || String(err),
    };
  }
}

async function recycleOne(targetPath) {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    return { path: resolved, ok: false, error: '路径不存在' };
  }
  if (process.platform === 'darwin') return recycleOneMac(resolved);
  if (process.platform === 'win32') return recycleOneWindows(resolved);
  return { path: resolved, ok: false, error: '当前系统暂不支持送入回收站' };
}

async function recyclePaths(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  const unique = [...new Set(list.filter(Boolean).map((p) => String(p)))];
  const results = await Promise.all(unique.map((p) => recycleOne(p)));
  return {
    ok: results.every((r) => r.ok),
    results,
  };
}

module.exports = { recyclePaths, recycleOne };
