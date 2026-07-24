/**
 * Create/update Gitee release tag `latest` and upload electron-updater assets.
 * Auth: git credential store for gitee.com (password used as access_token).
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { URL } = require('url');

const OWNER = 'dong-tianyi-11';
const REPO = 'black-hole-recycle-bin';
const DIST = path.join(__dirname, '..', 'dist');
const FILES = [
  'latest.yml',
  'BlackHoleRecycleBin-Setup-1.0.0-x64.exe',
  'BlackHoleRecycleBin-Setup-1.0.0-x64.exe.blockmap',
];

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
    name: 'v1.0.0',
    body:
      '黑洞回收站 v1.0.0\n\n自动更新通道（标签 latest）。安装本包后，应用内「检查更新」会从此处拉取。',
    target_commitish: 'master',
  });
  if (res.status >= 400) {
    throw new Error(`create release: ${res.status} ${res.text.slice(0, 400)}`);
  }
  return res.json;
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

  // Verify latest.yml is reachable
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
