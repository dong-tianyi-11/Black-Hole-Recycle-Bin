const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/** No wall-clock timeout — multi-GB folders can take a long time. */
const EXEC_OPTS = {
  windowsHide: true,
  timeout: 0,
  maxBuffer: 16 * 1024 * 1024,
};

function escapeForPowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function normalizeWinPath(targetPath) {
  return path.resolve(targetPath);
}

function writeTempPs1(scriptBody) {
  const file = path.join(
    os.tmpdir(),
    `bh-recycle-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`
  );
  // BOM helps PowerShell parse Unicode paths reliably
  fs.writeFileSync(file, `\uFEFF${scriptBody}`, 'utf8');
  return file;
}

async function runPowerShellFile(scriptBody) {
  const ps1 = writeTempPs1(scriptBody);
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      EXEC_OPTS
    );
  } finally {
    try {
      fs.unlinkSync(ps1);
    } catch (_) {}
  }
}

/**
 * SHFileOperation(FO_DELETE + FOF_ALLOWUNDO) — same as Explorer "delete".
 * Handles very large files/folders; no app-side size limit.
 */
function shFileOpScript(resolved) {
  const escaped = escapeForPowerShellSingleQuoted(resolved);
  // Note: in the C# source we need the two chars \ and 0 (C# null escape).
  const cSharpNull = '\\0';
  return `
$ErrorActionPreference = 'Stop'
$path = '${escaped}'
if (-not (Test-Path -LiteralPath $path)) { throw "路径不存在: $path" }

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class BHRecycleNative {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct SHFILEOPSTRUCT {
    public IntPtr hwnd;
    public uint wFunc;
    public IntPtr pFrom;
    public IntPtr pTo;
    public ushort fFlags;
    public int fAnyOperationsAborted;
    public IntPtr hNameMappings;
    public IntPtr lpszProgressTitle;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern int SHFileOperation(ref SHFILEOPSTRUCT fileOp);

  public static int SendToRecycleBin(string path) {
    // Double-null-terminated buffer required by SHFileOperation
    IntPtr pFrom = Marshal.StringToHGlobalUni(path + "${cSharpNull}");
    try {
      var op = new SHFILEOPSTRUCT();
      op.hwnd = IntPtr.Zero;
      op.wFunc = 3; // FO_DELETE
      op.pFrom = pFrom;
      op.pTo = IntPtr.Zero;
      // SILENT | NOCONFIRMATION | ALLOWUNDO | NOERRORUI
      op.fFlags = (ushort)(0x0004 | 0x0010 | 0x0040 | 0x0400);
      op.fAnyOperationsAborted = 0;
      op.hNameMappings = IntPtr.Zero;
      op.lpszProgressTitle = IntPtr.Zero;
      return SHFileOperation(ref op);
    } finally {
      Marshal.FreeHGlobal(pFrom);
    }
  }
}
"@

$code = [BHRecycleNative]::SendToRecycleBin($path)
if ($code -ne 0) {
  throw ("SHFileOperation failed, code=" + $code)
}
`;
}

/** VisualBasic FileIO fallback (also SendToRecycleBin). */
function vbFileIoScript(resolved, isDir) {
  const escaped = escapeForPowerShellSingleQuoted(resolved);
  const method = isDir ? 'DeleteDirectory' : 'DeleteFile';
  return `
$ErrorActionPreference = 'Stop'
$path = '${escaped}'
if (-not (Test-Path -LiteralPath $path)) { throw "路径不存在: $path" }
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::${method}($path, 'OnlyErrorDialogs', 'SendToRecycleBin')
`;
}

function formatRecycleError(raw) {
  const s = String(raw || '').trim();
  if (!s) return '送入回收站失败';
  if (/code=5|Access is denied|拒绝访问/i.test(s)) {
    return '没有权限（文件可能正在使用或需要管理员权限）';
  }
  if (/code=32|being used|占用/i.test(s)) {
    return '文件正在被使用，请先关闭相关程序';
  }
  if (/too big|太大|recycle bin|回收站/i.test(s)) {
    return '超过回收站容量：请在回收站属性中增大“最大空间”，或先清空回收站';
  }
  const oneLine = s.replace(/\s+/g, ' ');
  return oneLine.length > 180 ? `${oneLine.slice(0, 180)}…` : oneLine;
}

async function recycleOneWindows(resolved) {
  let isDir = false;
  try {
    isDir = fs.statSync(resolved).isDirectory();
  } catch (err) {
    return { path: resolved, ok: false, error: err.message || '无法读取路径' };
  }

  const attempts = [
    { name: 'SHFileOperation', script: shFileOpScript(resolved) },
    { name: 'VB.FileIO', script: vbFileIoScript(resolved, isDir) },
  ];

  let lastError = '';
  for (const attempt of attempts) {
    try {
      await runPowerShellFile(attempt.script);
      if (!fs.existsSync(resolved)) {
        return { path: resolved, ok: true };
      }
      lastError = `${attempt.name}: 操作后路径仍存在（可能被占用）`;
    } catch (err) {
      lastError =
        (err.stderr && String(err.stderr).trim()) || err.message || String(err);
    }
  }

  return {
    path: resolved,
    ok: false,
    error: formatRecycleError(lastError),
  };
}

async function recycleOneMac(resolved) {
  const posix = resolved.replace(/\\/g, '/');
  const escaped = posix.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  try {
    await execFileAsync(
      'osascript',
      ['-e', `tell application "Finder" to delete (POSIX file "${escaped}" as alias)`],
      { timeout: 0, maxBuffer: 16 * 1024 * 1024 }
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

async function recycleOne(targetPath) {
  const resolved = normalizeWinPath(targetPath);
  if (!fs.existsSync(resolved)) {
    return { path: resolved, ok: false, error: '路径不存在' };
  }
  if (process.platform === 'darwin') return recycleOneMac(resolved);
  if (process.platform === 'win32') return recycleOneWindows(resolved);
  return { path: resolved, ok: false, error: '当前系统暂不支持送入回收站' };
}

/** Sequential — one huge folder at a time keeps Shell32 stable. */
async function recyclePaths(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  const unique = [...new Set(list.filter(Boolean).map((p) => String(p)))];
  const results = [];
  for (const p of unique) {
    results.push(await recycleOne(p));
  }
  return {
    ok: results.every((r) => r.ok),
    results,
  };
}

module.exports = { recyclePaths, recycleOne };
