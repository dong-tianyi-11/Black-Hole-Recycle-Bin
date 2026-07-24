/**
 * Auto-update via Gitee Releases (generic provider + Gitee API fallback).
 * - Windows packaged: electron-updater downloads from Gitee `latest` release assets
 * - macOS packaged: check via Gitee API, open Releases page to install
 * - Dev (.git): optional message only
 *
 * Release layout (tag must be named `latest`):
 *   https://gitee.com/{owner}/{repo}/releases/download/latest/latest.yml
 *   + installer exe / blockmap attached to the same release
 */
const { app, shell, dialog } = require('electron');
const path = require('path');
const https = require('https');
const fs = require('fs');

const GITEE_OWNER = 'dong-tianyi-11';
const GITEE_REPO = 'black-hole-recycle-bin';

function readPublishConfig() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const pub = pkg.build?.publish;
    const first = Array.isArray(pub) ? pub[0] : pub;
    const owner = pkg.gitee?.owner || GITEE_OWNER;
    const repo = pkg.gitee?.repo || GITEE_REPO;
    const feedUrl =
      (first?.provider === 'generic' && first.url) ||
      `https://gitee.com/${owner}/${repo}/releases/download/latest`;

    return {
      provider: 'gitee',
      owner,
      repo,
      feedUrl: String(feedUrl).replace(/\/$/, ''),
      releasesUrl: `https://gitee.com/${owner}/${repo}/releases`,
      apiLatest: `https://gitee.com/api/v5/repos/${owner}/${repo}/releases/latest`,
    };
  } catch (_) {
    return {
      provider: 'gitee',
      owner: GITEE_OWNER,
      repo: GITEE_REPO,
      feedUrl: `https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/download/latest`,
      releasesUrl: `https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases`,
      apiLatest: `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/latest`,
    };
  }
}

function createUpdater(opts = {}) {
  const getConfig = opts.getConfig || (() => ({}));
  const saveConfig = opts.saveConfig || (() => {});
  const rebuildMenus = opts.rebuildMenus || (() => {});
  const getParentWindow = opts.getParentWindow || (() => null);

  let status = 'idle'; // idle | checking | available | downloading | ready
  let availableVersion = null;
  let autoUpdater = null;
  let schedulerTimer = null;
  let manualCheckPending = false;
  const publish = readPublishConfig();

  function menuLabel() {
    if (status === 'checking') return '正在检查更新…';
    if (status === 'downloading') return '正在下载更新…';
    if (status === 'ready') return `更新已就绪 · 重启安装`;
    if (status === 'available' && availableVersion) return `有新版本 v${availableVersion}`;
    return '检查更新';
  }

  function setStatus(next, version = availableVersion) {
    status = next;
    availableVersion = version;
    rebuildMenus();
  }

  function httpsJson(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(
        url,
        {
          headers: {
            'User-Agent': 'black-hole-recycle-bin',
            Accept: 'application/json',
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(err);
            }
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy(new Error('timeout'));
      });
    });
  }

  function setupAutoUpdater() {
    if (!app.isPackaged || process.platform !== 'win32') return;
    try {
      autoUpdater = require('electron-updater').autoUpdater;
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;
      // Force Gitee generic feed (overrides any stale GitHub app-update.yml)
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: publish.feedUrl,
      });

      autoUpdater.on('checking-for-update', () => setStatus('checking'));
      autoUpdater.on('update-available', (info) => {
        manualCheckPending = false;
        setStatus('available', info.version);
        promptUpdate(info.version, true);
      });
      autoUpdater.on('update-not-available', () => {
        const wasManual = manualCheckPending;
        manualCheckPending = false;
        setStatus('idle', null);
        if (wasManual) {
          dialog.showMessageBox({
            type: 'info',
            title: '已是最新',
            message: `当前版本 v${app.getVersion()}`,
          });
        }
      });
      autoUpdater.on('download-progress', () => setStatus('downloading'));
      autoUpdater.on('update-downloaded', (info) => {
        manualCheckPending = false;
        setStatus('ready', info.version);
        promptRestart(info.version);
      });
      autoUpdater.on('error', (err) => {
        console.warn('[updater]', err?.message || err);
        const wasManual = manualCheckPending;
        manualCheckPending = false;
        setStatus('idle');
        if (wasManual) {
          // Fall back to Gitee API / latest.yml when generic feed fails
          checkViaGiteeApi(true);
        }
      });
    } catch (err) {
      console.warn('[updater] electron-updater unavailable', err);
    }
  }

  async function promptUpdate(version, canDownload) {
    const win = getParentWindow();
    const buttons = canDownload
      ? ['立即下载', '稍后再说']
      : ['打开下载页', '稍后再说'];
    const result = await dialog.showMessageBox(win || undefined, {
      type: 'info',
      title: '发现新版本',
      message: `黑洞回收站 v${version} 可用`,
      detail: canDownload
        ? '下载完成后可重启安装。'
        : 'macOS 请从 Gitee Releases 下载最新安装包。',
      buttons,
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response !== 0) return;
    if (canDownload && autoUpdater) {
      setStatus('downloading', version);
      try {
        await autoUpdater.downloadUpdate();
      } catch (err) {
        setStatus('available', version);
        dialog.showErrorBox('下载失败', err?.message || String(err));
      }
    } else if (publish) {
      shell.openExternal(publish.releasesUrl);
    }
  }

  async function promptRestart(version) {
    const win = getParentWindow();
    const result = await dialog.showMessageBox(win || undefined, {
      type: 'info',
      title: '更新已下载',
      message: `v${version} 已准备就绪`,
      detail: '重启应用以完成安装。',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0 && autoUpdater) {
      autoUpdater.quitAndInstall(false, true);
    }
  }

  async function httpsText(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(
        url,
        { headers: { 'User-Agent': 'black-hole-recycle-bin', Accept: '*/*' } },
        (res) => {
          // Follow one redirect (Gitee sometimes redirects downloads)
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            httpsText(res.headers.location).then(resolve, reject);
            res.resume();
            return;
          }
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            resolve(data);
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    });
  }

  async function resolveRemoteVersion() {
    // Prefer latest.yml from the rolling `latest` release (authoritative for updater)
    try {
      const yml = await httpsText(`${publish.feedUrl}/latest.yml`);
      const m = String(yml).match(/^\s*version:\s*['"]?([0-9][^'"\s]*)/m);
      if (m) return m[1];
    } catch (_) {}

    const release = await httpsJson(publish.apiLatest);
    const fromName = String(release.name || '').match(/v?(\d+\.\d+\.\d[\w.-]*)/i);
    if (fromName) return fromName[1];
    const tag = String(release.tag_name || '').replace(/^v/i, '');
    if (tag && !/^latest$/i.test(tag)) return tag;
    return '';
  }

  async function checkViaGiteeApi(manual) {
    if (!publish?.apiLatest) {
      if (manual) {
        dialog.showMessageBox({
          type: 'warning',
          title: '未配置更新源',
          message: '请在 package.json 中设置 gitee.owner / gitee.repo',
        });
      }
      return;
    }
    setStatus('checking');
    try {
      const version = await resolveRemoteVersion();
      const current = app.getVersion();
      if (version && version !== current && isNewer(version, current)) {
        setStatus('available', version);
        if (manual) {
          await promptUpdate(version, process.platform === 'win32' && !!autoUpdater);
        }
      } else {
        setStatus('idle', null);
        if (manual) {
          dialog.showMessageBox({
            type: 'info',
            title: '已是最新',
            message: `当前版本 v${current}`,
          });
        }
      }
    } catch (err) {
      setStatus('idle');
      if (manual) {
        dialog.showErrorBox('检查更新失败', err?.message || String(err));
      }
    }
  }

  function isNewer(remote, local) {
    const parse = (v) =>
      String(v)
        .split('.')
        .map((n) => parseInt(n, 10) || 0);
    const a = parse(remote);
    const b = parse(local);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] || 0;
      const y = b[i] || 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return false;
  }

  async function checkForUpdates(manual = true) {
    if (!app.isPackaged) {
      if (manual) {
        dialog.showMessageBox({
          type: 'info',
          title: '开发模式',
          message: '当前为开发运行，请使用打包后的安装版检查更新。',
          detail: publish ? `发布页：${publish.releasesUrl}` : '',
        });
      }
      return;
    }

    if (status === 'ready' && autoUpdater) {
      autoUpdater.quitAndInstall(false, true);
      return;
    }

    if (process.platform === 'win32' && autoUpdater) {
      manualCheckPending = !!manual;
      setStatus('checking');
      try {
        await autoUpdater.checkForUpdates();
      } catch (err) {
        manualCheckPending = false;
        // Fallback to Gitee API (e.g. missing latest.yml)
        await checkViaGiteeApi(manual);
      }
      return;
    }

    // macOS (and other): API check → open browser
    await checkViaGiteeApi(manual);
  }

  function getUpdateMenuItem() {
    return {
      label: menuLabel(),
      enabled: status !== 'checking' && status !== 'downloading',
      click: () => {
        if (status === 'ready' && autoUpdater) autoUpdater.quitAndInstall(false, true);
        else checkForUpdates(true);
      },
    };
  }

  function startScheduler() {
    stopScheduler();
    const cfg = getConfig();
    if (cfg.autoUpdateCheck === false) return;
    if (!app.isPackaged) return;

    const first = 2 * 60 * 1000 + Math.random() * 3 * 60 * 1000;
    const every = 12 * 60 * 60 * 1000;

    const tick = async () => {
      try {
        if (getConfig().autoUpdateCheck === false) return;
        if (status === 'downloading' || status === 'ready') return;
        if (process.platform === 'win32' && autoUpdater) {
          await autoUpdater.checkForUpdates();
        } else {
          await checkViaGiteeApi(false);
        }
      } catch (_) {}
      schedulerTimer = setTimeout(tick, every);
    };
    schedulerTimer = setTimeout(tick, first);
  }

  function stopScheduler() {
    if (schedulerTimer) {
      clearTimeout(schedulerTimer);
      schedulerTimer = null;
    }
  }

  function setAutoUpdateCheck(on) {
    saveConfig({ autoUpdateCheck: !!on });
    if (on) startScheduler();
    else stopScheduler();
    rebuildMenus();
  }

  return {
    setupAutoUpdater,
    checkForUpdates,
    getUpdateMenuItem,
    startScheduler,
    stopScheduler,
    setAutoUpdateCheck,
    menuLabel,
  };
}

module.exports = { createUpdater, readPublishConfig };
