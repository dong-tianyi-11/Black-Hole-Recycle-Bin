/**
 * Create/update Gitee release tag `latest` and upload electron-updater assets.
 * Auth: git credential store for gitee.com (password used as access_token).
 *
 * Usage: npm run build:win && npm run publish:gitee
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const OWNER = pkg.gitee?.owner || 'dong-tianyi-11';
const REPO = pkg.gitee?.repo || 'black-hole-recycle-bin';
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
  // Fallback naming if yml parse missed
  const exe = `BlackHoleRecycleBin-Setup-${VERSION}-x64.exe`;
  if (fs.existsSync(path.join(DIST, exe))) {
    files.add(exe);
    const bm = `${exe}.blockmap`;
    if (fs.existsSync(path.join(DIST, bm))) files.add(bm);
  }
  return [...files];
}

function getToken() {
  const input = 'protocol=https\nhost=gitee.com\n\n';
  const r = spawnSync('git', ['credential', 'fill'], { input, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('git credential fill failed');
  const map = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) map[line.slice(0, i)] = line.slice(i + 1);
  }
  if (!map.password) throw new Error('no gitee password/token in credential store');
  return map.password.trim();
}

function request(method, urlStr, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers,
    };
    const req = https.request(opts, (res) => {
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
    req.setTimeout(15 * 60 * 1000, () => req.destroy(new Error('timeout')));
    if (body) req.end(body);
    else req.end();
  });
}

async function api(method, apiPath, token, bodyObj) {
  const qs = new URLSearchParams({ access_token: token });
  let body = null;
  const headers = {
    'User-Agent': 'black-hole-recycle-bin-release',
    Accept: 'application/json',
  };
  if (bodyObj) {
    body = JSON.stringify(bodyObj);
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  const url =
    'https://gitee.com/api/v5' + apiPath + (apiPath.includes('?') ? '&' : '?') + qs.toString();
  return request(method, url, { headers, body });
}

async function findReleaseByTag(token, tag) {
  const res = await api(
    'GET',
    `/repos/${OWNER}/${REPO}/releases?page=1&per_page=50`,
    token
  );
  if (res.status >= 400) {
    throw new Error(`list releases: ${res.status} ${res.text.slice(0, 200)}`);
  }
  const list = Array.isArray(res.json) ? res.json : [];
  return list.find((r) => r.tag_name === tag) || null;
}

async function createRelease(token) {
  const res = await api('POST', `/repos/${OWNER}/${REPO}/releases`, token, {
    tag_name: 'latest',
    name: `v${VERSION}`,
    body: releaseBody(),
    target_commitish: 'master',
  });
  if (res.status >= 400) {
    throw new Error(`create release: ${res.status} ${res.text.slice(0, 400)}`);
  }
  return res.json;
}

function releaseBody() {
  return [
    `黑洞回收站 v${VERSION}`,
    '',
    '自动更新通道（发行版标签必须为 `latest`）。',
    '',
    '安装本包后，托盘菜单可「检查更新」。',
    '',
    '### 1.0.1',
    '- 拖拽不再误触窗口缩放；单击更稳',
    '- 拖完后点击穿透状态修复',
    '- 检查更新提示更准确（Gitee）',
    '- 托盘显示当前版本号',
  ].join('\n');
}

async function updateReleaseMeta(token, releaseId) {
  const res = await api('PATCH', `/repos/${OWNER}/${REPO}/releases/${releaseId}`, token, {
    tag_name: 'latest',
    name: `v${VERSION}`,
    body: releaseBody(),
  });
  if (res.status >= 400) {
    console.warn('update release meta skipped:', res.status, res.text.slice(0, 200));
  } else {
    console.log('release meta updated to', `v${VERSION}`);
  }
}

async function listAttachFiles(token, releaseId) {
  const res = await api(
    'GET',
    `/repos/${OWNER}/${REPO}/releases/${releaseId}/attach_files`,
    token
  );
  if (res.status >= 400) {
    console.warn('list attach files failed:', res.status, res.text.slice(0, 200));
    return [];
  }
  return Array.isArray(res.json) ? res.json : [];
}

async function deleteAttachFile(token, releaseId, attachId) {
  const res = await api(
    'DELETE',
    `/repos/${OWNER}/${REPO}/releases/${releaseId}/attach_files/${attachId}`,
    token
  );
  return res.status < 400 || res.status === 204;
}

async function clearOldAssets(token, releaseId, fileNames) {
  const want = new Set(fileNames.map((f) => f.toLowerCase()));
  const assets = await listAttachFiles(token, releaseId);
  for (const a of assets) {
    const name = String(a.name || '').toLowerCase();
    const id = a.id;
    // Remove same-name files and any previous Setup/latest.yml artifacts so download/latest resolves cleanly
    const isUpdateAsset =
      want.has(name) ||
      name === 'latest.yml' ||
      /^blackholerecyclebin-setup-.*\.exe(\.blockmap)?$/i.test(name);
    if (id && isUpdateAsset) {
      console.log('removing old asset', name, id);
      const ok = await deleteAttachFile(token, releaseId, id);
      console.log(ok ? 'removed' : 'remove failed', name);
    }
  }
}

async function multipartUpload(token, releaseId, filePath) {
  const fileName = path.basename(filePath);
  const fileBuf = fs.readFileSync(filePath);
  const boundary = `----BHRB${Date.now().toString(16)}`;
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(head, 'utf8'), fileBuf, Buffer.from(tail, 'utf8')]);
  const qs = new URLSearchParams({ access_token: token });
  const url =
    `https://gitee.com/api/v5/repos/${OWNER}/${REPO}/releases/${releaseId}/attach_files?` +
    qs.toString();
  return request('POST', url, {
    headers: {
      'User-Agent': 'black-hole-recycle-bin-release',
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
      Accept: 'application/json',
    },
    body,
  });
}

(async () => {
  const FILES = resolveFiles();
  console.log('version', VERSION);
  console.log('files', FILES.join(', '));
  for (const f of FILES) {
    const p = path.join(DIST, f);
    if (!fs.existsSync(p)) throw new Error(`missing ${p}`);
  }
  const token = getToken();
  console.log('auth ok');

  let release = await findReleaseByTag(token, 'latest');
  if (!release) {
    console.log('creating release tag=latest');
    release = await createRelease(token);
  } else {
    console.log(`release exists id=${release.id}`);
    await updateReleaseMeta(token, release.id);
    await clearOldAssets(token, release.id, FILES);
  }

  const id = release.id;
  let failed = false;
  for (const f of FILES) {
    const p = path.join(DIST, f);
    const mb = (fs.statSync(p).size / 1048576).toFixed(2);
    console.log(`uploading ${f} (${mb} MB) ...`);
    const r = await multipartUpload(token, id, p);
    if (r.status >= 400) {
      console.error(`FAIL ${f} ${r.status} ${r.text.slice(0, 500)}`);
      failed = true;
    } else {
      console.log(`OK ${f} ${r.status}`);
    }
  }

  const checkUrl = `https://gitee.com/${OWNER}/${REPO}/releases/download/latest/latest.yml`;
  console.log('checking', checkUrl);
  const check = await new Promise((resolve) => {
    https
      .get(checkUrl, { headers: { 'User-Agent': 'bhrb' } }, (res) => {
        resolve({ status: res.statusCode, location: res.headers.location });
        res.resume();
      })
      .on('error', (e) => resolve({ error: e.message }));
  });
  console.log('latest.yml check', check);

  if (failed) process.exit(1);
  console.log(`done: https://gitee.com/${OWNER}/${REPO}/releases`);
})().catch((e) => {
  console.error('ERROR', e.message || e);
  process.exit(1);
});
