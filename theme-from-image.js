/**
 * Generate a pet theme from one reference image via OpenAI-compatible Vision API.
 * User supplies apiKey (+ optional baseUrl / model).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { sanitizeThemeDirName, RESERVED_THEME_IDS } = require('./theme-importer');

const VIEW_W = 266;
const VIEW_H = 200;
const DEFAULT_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o';

const SYSTEM_PROMPT = `你是桌宠皮肤设计师。根据用户上传的参考图，生成一套可直接使用的 SVG 桌宠素材。
严格输出一个 JSON 对象（不要 markdown 代码块），字段如下：
{
  "name": "简短中文主题名",
  "eatLabel": "2-6字称呼",
  "toastOk": "吃掉文件成功时的短句",
  "toastFail": "失败时的短句",
  "assets": {
    "idle": "<svg ...>...</svg>",
    "eat-open": "<svg ...>...</svg>",
    "eat-chew": "<svg ...>...</svg>",
    "poke": "<svg ...>...</svg>",
    "drag": "<svg ...>...</svg>"
  }
}
要求：
1. 每个 SVG 必须是完整合法 XML，根元素 <svg>，viewBox="0 0 266 200"，宽高与角色居中。
2. 背景透明（不要画不透明白底矩形）。
3. 造型忠实于参考图的角色特征与配色，做成适合桌面宠物的清晰矢量卡通。
4. idle=待机；eat-open=张嘴；eat-chew=咀嚼；poke=被戳；drag=被拖拽。
5. 不要输出 JSON 以外的任何文字。`;

function uniqueThemeId(userThemesDir, baseName) {
  let id = sanitizeThemeDirName(baseName) || 'ai-pet';
  id = id.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff\-]+/gi, '-') || 'ai-pet';
  if (RESERVED_THEME_IDS.has(id)) id = `pet-${id}`;
  let candidate = id;
  let n = 2;
  while (fs.existsSync(path.join(userThemesDir, candidate))) {
    candidate = `${id}-${n++}`;
  }
  return candidate;
}

function mimeFromPath(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function imageToDataUrl(imagePath) {
  let buf;
  let mime = mimeFromPath(imagePath);
  try {
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromPath(imagePath);
    if (!img || img.isEmpty()) throw new Error('empty');
    const size = img.getSize();
    const longest = Math.max(size.width, size.height);
    let ni = img;
    if (longest > 1280) {
      const scale = 1280 / longest;
      ni = img.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'better',
      });
    }
    // JPEG is smaller for API upload
    buf = ni.toJPEG(85);
    mime = 'image/jpeg';
  } catch (_) {
    buf = fs.readFileSync(imagePath);
  }
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('AI 返回为空');
  try {
    return JSON.parse(raw);
  } catch (_) {}
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    return JSON.parse(fence[1].trim());
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(raw.slice(start, end + 1));
  }
  throw new Error('AI 返回不是有效 JSON');
}

function cleanSvg(svg) {
  let s = String(svg || '').trim();
  if (!s) return '';
  const fence = s.match(/```(?:svg|xml)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (!/^<svg[\s>]/i.test(s)) {
    const i = s.indexOf('<svg');
    if (i >= 0) s = s.slice(i);
  }
  if (!/<svg[\s\S]*<\/svg>/i.test(s)) return '';
  // Ensure viewBox
  if (!/viewBox=/i.test(s)) {
    s = s.replace(/<svg\b/i, `<svg viewBox="0 0 ${VIEW_W} ${VIEW_H}"`);
  }
  return s;
}

/** Cross-platform HTTP JSON (works without global fetch on older runtimes). */
function httpJson(url, { method = 'GET', headers = {}, body, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(new Error(`无效的 Base URL：${url}`));
      return;
    }
    const lib = parsed.protocol === 'http:' ? http : https;
    const payload = body != null ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8') : null;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          ...headers,
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
            : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode || 0, text });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('AI 请求超时，请检查网络或 Base URL'));
    });
    req.on('error', (err) => reject(new Error(err.message || String(err))));
    if (payload) req.write(payload);
    req.end();
  });
}

async function postChatCompletions(url, apiKey, body) {
  return httpJson(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
    timeoutMs: 180000,
  });
}

async function callVisionApi({ apiKey, baseUrl, model, dataUrl }) {
  const root = String(baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  const url = `${root}/chat/completions`;
  const body = {
    model: model || DEFAULT_MODEL,
    temperature: 0.35,
    max_tokens: 12000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '请根据这张参考图生成桌宠主题 JSON（含 idle / eat-open / eat-chew / poke / drag 五个 SVG）。',
          },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        ],
      },
    ],
  };

  // Prefer JSON mode when supported; ignore failure by retrying without it
  let res = await postChatCompletions(url, apiKey, {
    ...body,
    response_format: { type: 'json_object' },
  });

  if (!res.ok) {
    if (res.status === 400 && /response_format|json_object/i.test(res.text || '')) {
      res = await postChatCompletions(url, apiKey, body);
    } else {
      throw new Error(formatApiError(res.status, res.text));
    }
  }

  if (!res.ok) {
    throw new Error(formatApiError(res.status, res.text));
  }

  let data;
  try {
    data = JSON.parse(res.text);
  } catch (_) {
    throw new Error('AI 返回了无法解析的响应');
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 没有返回内容，请换模型或检查额度');
  return extractJson(content);
}

/** Lightweight real API probe (models list or tiny chat). */
async function testAiConnection({ apiKey, baseUrl, model } = {}) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, message: '请先填写 API Key' };
  const root = String(baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  const mdl = String(model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;

  try {
    // Prefer /models (cheap); fall back to a 1-token chat if gateway has no models route
    let res = await httpJson(`${root}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      timeoutMs: 30000,
    });
    if (res.ok) {
      return { ok: true, message: `连接成功（已验证 Key，模型将使用：${mdl}）` };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: formatApiError(res.status, res.text) };
    }

    res = await postChatCompletions(`${root}/chat/completions`, key, {
      model: mdl,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    if (res.ok) return { ok: true, message: `连接成功（chat 可用，模型：${mdl}）` };
    return { ok: false, message: formatApiError(res.status, res.text) };
  } catch (err) {
    return { ok: false, message: (err && err.message) || String(err) };
  }
}

function formatApiError(status, text) {
  let detail = String(text || '').slice(0, 400);
  try {
    const j = JSON.parse(text);
    detail = j.error?.message || j.message || detail;
  } catch (_) {}
  if (status === 401) return `API Key 无效或未授权（401）：${detail}`;
  if (status === 402 || status === 429) return `额度不足或请求过频（${status}）：${detail}`;
  return `AI 请求失败（HTTP ${status}）：${detail}`;
}

function writeThemeFromAi(dest, themeId, parsed) {
  const assetsDir = path.join(dest, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const map = {
    idle: 'idle.svg',
    'eat-open': 'eat-open.svg',
    'eat-chew': 'eat-chew.svg',
    poke: 'poke.svg',
    drag: 'drag.svg',
  };
  const assets = parsed.assets || {};
  for (const [key, file] of Object.entries(map)) {
    const svg = cleanSvg(assets[key] || assets[key.replace('-', '')]);
    if (!svg) {
      if (key === 'idle' || key === 'eat-open' || key === 'eat-chew') {
        throw new Error(`AI 未生成有效的 ${key} SVG`);
      }
      continue;
    }
    fs.writeFileSync(path.join(assetsDir, file), svg, 'utf8');
  }

  // Fill missing optional with idle
  const idlePath = path.join(assetsDir, 'idle.svg');
  for (const opt of ['poke.svg', 'drag.svg', 'eat-chew.svg']) {
    const p = path.join(assetsDir, opt);
    if (!fs.existsSync(p) && fs.existsSync(idlePath)) {
      fs.copyFileSync(idlePath, p);
    }
  }

  const name = String(parsed.name || themeId).slice(0, 40);
  const meta = {
    schemaVersion: 1,
    id: themeId,
    name,
    type: 'pet',
    author: 'ai',
    version: '1.0.0',
    description: '由参考图 + AI 生成',
    viewBox: { x: 0, y: 0, width: VIEW_W, height: VIEW_H },
    eatLabel: String(parsed.eatLabel || name).slice(0, 8),
    toastOk: String(parsed.toastOk || '收下啦～').slice(0, 40),
    toastFail: String(parsed.toastFail || '吃不下…').slice(0, 40),
    sleepSequence: { mode: 'direct' },
    timings: {
      reactPoke: 1400,
      reactDrag: 1600,
      eatChew: 1600,
      waking: 1600,
    },
    states: {
      idle: ['idle.svg'],
      reactPoke: fs.existsSync(path.join(assetsDir, 'poke.svg')) ? ['poke.svg'] : ['idle.svg'],
      reactDrag: fs.existsSync(path.join(assetsDir, 'drag.svg')) ? ['drag.svg'] : ['idle.svg'],
      sleeping: ['idle.svg'],
      waking: ['idle.svg'],
      eatOpen: ['eat-open.svg'],
      eatChew: ['eat-chew.svg'],
      attention: { fallbackTo: 'reactPoke' },
      error: { fallbackTo: 'idle' },
      notification: { fallbackTo: 'idle' },
    },
    miniMode: {
      supported: true,
      flipAssets: false,
      offsetRatio: 0.45,
    },
  };
  fs.writeFileSync(path.join(dest, 'theme.json'), JSON.stringify(meta, null, 2), 'utf8');
  return name;
}

/**
 * @param {string} imagePath
 * @param {string} userThemesDir
 * @param {{ apiKey: string, baseUrl?: string, model?: string, name?: string }} ai
 */
async function createThemeFromImage(imagePath, userThemesDir, ai = {}) {
  try {
    if (!userThemesDir) throw new Error('用户主题目录不可用');
    if (!imagePath || !fs.existsSync(imagePath)) throw new Error('请选择一张有效的图片');
    const apiKey = String(ai.apiKey || '').trim();
    if (!apiKey) throw new Error('请先填写 AI API Key');

    const dataUrl = imageToDataUrl(imagePath);
    const parsed = await callVisionApi({
      apiKey,
      baseUrl: ai.baseUrl,
      model: ai.model,
      dataUrl,
    });

    const fallbackName = path.basename(imagePath, path.extname(imagePath));
    const nameHint = String(ai.name || parsed.name || fallbackName).slice(0, 40);
    const themeId = uniqueThemeId(userThemesDir, nameHint);
    const dest = path.join(userThemesDir, themeId);
    fs.mkdirSync(dest, { recursive: true });

    const name = writeThemeFromAi(dest, themeId, { ...parsed, name: nameHint });
    return { status: 'ok', themeId, name, path: dest };
  } catch (err) {
    return {
      status: 'error',
      message: (err && err.message) || String(err),
    };
  }
}

module.exports = {
  createThemeFromImage,
  testAiConnection,
  DEFAULT_BASE,
  DEFAULT_MODEL,
};
