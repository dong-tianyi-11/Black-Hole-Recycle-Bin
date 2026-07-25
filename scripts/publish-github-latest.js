/**
 * Create/update GitHub release tag `latest` and upload electron-updater assets.
 * Auth: git credential store for github.com (password used as access_token / PAT).
 * Uses http.https://github.com.proxy from git config when set.
 *
 * Usage: npm run build:win && npm run publish:github
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const OWNER = 'dong-tianyi-11';
const REPO = 'Black-Hole-Recycle-Bin';
const VERSION = String(pkg.version);

function resolveFiles() {
  const ymlPath = path.join(DIST, 'latest.yml');
  if (!fs.existsSync(ymlPath)) {
    throw new Error(`missing ${ymlPath} — run npm run build:win first`);
  }
  const yml = fs.readFileSync(ymlPath, 'utf8');
  const urls = [...yml.matchAll(/^\s*url:\s*(.+)\s*$/gm)].map((m) => m[1].trim());
  const files = new Set(['latest.yml']);
  for (const u of urls) {
    files.add(u);
    const blockmap = `${u}.blockmap`;
    if (fs.existsSync(path.join(DIST, blockmap))) files.add(blockmap);
  }
  const exe = `BlackHoleRecycleBin-Setup-${VERSION}-x64.exe`;
  if (fs.existsSync(path.join(DIST, exe))) {
    files.add(exe);
    const bm = `${exe}.blockmap`;
    if (fs.existsSync(path.join(DIST, bm))) files.add(bm);
  }
  return [...files];
}

function getToken() {
  const input = 'protocol=https\nhost=github.com\n\n';
  const r = spawnSync('git', ['credential', 'fill'], { input, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('git credential fill failed for github.com');
  const map = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) map[line.slice(0, i)] = line.slice(i + 1);
  }
  if (!map.password) throw new Error('no github password/token in credential store');
  return map.password.trim();
}

function getProxyAgent(urlStr) {
  try {
    const r = spawnSync('git', ['config', '--get', 'http.https://github.com.proxy'], {
      encoding: 'utf8',
    });
    const proxy = (r.stdout || '').trim();
    if (!proxy) return null;
    const { HttpsProxyAgent } = require('https-proxy-agent');
    return new HttpsProxyAgent(proxy);
  } catch (_) {
    // fallback: env
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY;
    if (!proxy) return null;
    try {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      return new HttpsProxyAgent(proxy);
    } catch (_) {
      return null;
    }
  }
}

function request(method, urlStr, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const agent = getProxyAgent(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const opts = {
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers,
      agent: agent || undefined,
    };
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(30 * 60 * 1000, () => req.destroy(new Error('timeout')));
    if (body) req.end(body);
    else req.end();
  });
}

async function api(method, apiPath, token, bodyObj) {
  let body = null;
  const headers = {
    'User-Agent': 'black-hole-recycle-bin-release',
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (bodyObj) {
    body = JSON.stringify(bodyObj);
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  return request(method, `https://api.github.com${apiPath}`, { headers, body });
}

function releaseBody() {
  return [
    `黑洞回收站 v${VERSION}`,
    '',
    'Windows x64 安装包（含 electron-updater 所需 `latest.yml`）。',
    '',
    '### 本版',
    '- 键盘输入 / 听歌状态桌宠反馈',
    '- 炼丹少年主题',
    '- 三花小猫听歌 / 吃文件 SVG 动画',
  ].join('\n');
}

async function getOrCreateLatest(token) {
  let res = await api('GET', `/repos/${OWNER}/${REPO}/releases/tags/latest`, token);
  if (res.status === 200 && res.json?.id) {
    console.log('release exists id=', res.json.id);
    const patch = await api('PATCH', `/repos/${OWNER}/${REPO}/releases/${res.json.id}`, token, {
      tag_name: 'latest',
      name: `v${VERSION}`,
      body: releaseBody(),
      draft: false,
      prerelease: false,
    });
    if (patch.status >= 400) {
      console.warn('patch meta failed', patch.status, patch.text.slice(0, 200));
    }
    return res.json;
  }
  console.log('creating release tag=latest');
  res = await api('POST', `/repos/${OWNER}/${REPO}/releases`, token, {
    tag_name: 'latest',
    name: `v${VERSION}`,
    body: releaseBody(),
    draft: false,
    prerelease: false,
  });
  if (res.status >= 400) {
    throw new Error(`create release: ${res.status} ${res.text.slice(0, 400)}`);
  }
  return res.json;
}

async function clearAssets(token, release) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  for (const a of assets) {
    const name = String(a.name || '');
    if (
      name === 'latest.yml' ||
      /^BlackHoleRecycleBin-Setup-.*\.exe(\.blockmap)?$/i.test(name)
    ) {
      console.log('removing old asset', name, a.id);
      const r = await api('DELETE', `/repos/${OWNER}/${REPO}/releases/assets/${a.id}`, token);
      console.log(r.status < 400 || r.status === 204 ? 'removed' : 'remove failed', name, r.status);
    }
  }
}

async function uploadAsset(token, uploadUrlTemplate, filePath) {
  const fileName = path.basename(filePath);
  const fileBuf = fs.readFileSync(filePath);
  const base = String(uploadUrlTemplate).split('{')[0];
  const url = `${base}?name=${encodeURIComponent(fileName)}`;
  return request('POST', url, {
    headers: {
      'User-Agent': 'black-hole-recycle-bin-release',
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileBuf.length,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: fileBuf,
  });
}

(async () => {
  // Prefer undici/proxy via env if https-proxy-agent missing
  const proxy =
    spawnSync('git', ['config', '--get', 'http.https://github.com.proxy'], { encoding: 'utf8' })
      .stdout?.trim() || '';
  if (proxy) {
    process.env.HTTPS_PROXY = process.env.HTTPS_PROXY || proxy;
    process.env.HTTP_PROXY = process.env.HTTP_PROXY || proxy;
  }

  let hasAgent = false;
  try {
    require.resolve('https-proxy-agent');
    hasAgent = true;
  } catch (_) {}
  if (proxy && !hasAgent) {
    console.log('installing https-proxy-agent for GitHub proxy...');
    const r = spawnSync('npm', ['install', 'https-proxy-agent@7', '--no-save'], {
      cwd: ROOT,
      encoding: 'utf8',
      shell: true,
    });
    if (r.status !== 0) console.warn(r.stderr || r.stdout);
  }

  const FILES = resolveFiles();
  console.log('version', VERSION);
  console.log('files', FILES.join(', '));
  const token = getToken();
  console.log('auth ok');

  let release = await getOrCreateLatest(token);
  // refresh assets list
  const refreshed = await api('GET', `/repos/${OWNER}/${REPO}/releases/${release.id}`, token);
  if (refreshed.status === 200) release = refreshed.json;
  await clearAssets(token, release);

  const uploadUrl = release.upload_url;
  if (!uploadUrl) throw new Error('missing upload_url');

  let failed = false;
  for (const f of FILES) {
    const p = path.join(DIST, f);
    const mb = (fs.statSync(p).size / 1048576).toFixed(2);
    console.log(`uploading ${f} (${mb} MB) ...`);
    const r = await uploadAsset(token, uploadUrl, p);
    if (r.status >= 400) {
      console.error(`FAIL ${f} ${r.status} ${r.text.slice(0, 500)}`);
      failed = true;
    } else {
      console.log(`OK ${f} ${r.status}`);
    }
  }

  if (failed) process.exit(1);
  console.log(`done: https://github.com/${OWNER}/${REPO}/releases/tag/latest`);
})().catch((e) => {
  console.error('ERROR', e.message || e);
  process.exit(1);
});
