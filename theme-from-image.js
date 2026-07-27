/**
 * Generate a pet theme from one reference image via OpenAI-compatible Vision API.
 * User supplies apiKey (+ optional baseUrl / model).
 *
 * Strategy: multi-step (analyze → idle SVG → expression variants) to avoid
 * huge single responses that gateways often block (429 / Request Blocked).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { sanitizeThemeDirName, RESERVED_THEME_IDS } = require('./theme-importer');

const VIEW_W = 266;
const VIEW_H = 200;
const DEFAULT_BASE = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';

/**
 * Hosts that are often blocked / unstable from mainland networks.
 * Not forbidden — we warn + preflight, and prefer domestic presets.
 */
const RISKY_HOST_RE =
  /(?:^|\.)(?:openai\.com|anthropic\.com|googleapis\.com|generativelanguage\.googleapis\.com|api\.openai\.com|chatgpt\.com)$/i;

const DOMESTIC_HOST_RE =
  /(?:deepseek\.com|siliconflow\.cn|dashscope\.aliyuncs\.com|bigmodel\.cn|moonshot\.cn|lingyiwanwu\.com|baichuan-ai\.com|volces\.com|hunyuan\.cloud\.tencent\.com|baidubce\.com|baidu\.com)/i;

function getHost(baseUrl) {
  try {
    return new URL(normalizeBaseUrl(baseUrl)).host;
  } catch (_) {
    return '';
  }
}

/** Classify endpoint risk for UX / preflight. */
function assessEndpoint(baseUrl, model) {
  const root = normalizeBaseUrl(baseUrl);
  const host = getHost(root);
  const mdl = String(model || '').trim();
  const vision = detectVisionSupport(root, mdl);
  const riskyForeign = RISKY_HOST_RE.test(host);
  const domestic = DOMESTIC_HOST_RE.test(host);
  let preset = PROVIDER_PRESETS.find((p) => {
    if (!p.baseUrl) return false;
    try {
      return new URL(normalizeBaseUrl(p.baseUrl)).host === host;
    } catch (_) {
      return false;
    }
  });

  return {
    root,
    host,
    model: mdl,
    vision: vision.vision,
    visionReason: vision.reason,
    riskyForeign,
    domestic,
    presetId: preset?.id || 'custom',
    presetLabel: preset?.label || '自定义',
    advice: riskyForeign
      ? '该地址在国内常被网关拦截（429 Request Blocked）。建议改用 DeepSeek / 硅基流动 / 百炼 / 智谱等预设。'
      : vision.vision === false
        ? vision.reason || '当前模型不识图，将使用文字描述生成。'
        : '将优先识图生成；若识图失败且已填写描述，会自动改用文字生成。',
  };
}

function preferPlainChatFirst(root) {
  // Many CN gateways are happier without response_format
  return DOMESTIC_HOST_RE.test(root) || /openrouter\.ai/i.test(root);
}

function isHtmlGatewayBlock(text = '', status = 0) {
  const t = String(text || '');
  if (/<!DOCTYPE\s+html|<html[\s>]/i.test(t) && /request\s*blocked|access\s*denied|just a moment|cloudflare|禁止访问|被拦截/i.test(t)) {
    return true;
  }
  if ((status === 403 || status === 429 || status === 503) && /<!DOCTYPE\s+html|<html[\s>]/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Cheap preflight before theme generation — catch bad URL/Key/blocks early.
 */
async function preflightAi({ apiKey, baseUrl, model } = {}) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, message: '请先填写 API Key' };
  const info = assessEndpoint(baseUrl, model);
  if (!info.model) {
    return {
      ok: false,
      message: `未填写模型名（当前 ${info.host || info.root}）。火山方舟需填接入点 ID，其它服务商请填具体模型。`,
    };
  }

  const url = `${info.root}/chat/completions`;
  const bodies = preferPlainChatFirst(info.root)
    ? [
        { model: info.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] },
        {
          model: info.model,
          max_completion_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        },
      ]
    : [
        {
          model: info.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        },
        {
          model: info.model,
          max_completion_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        },
      ];

  let lastMsg = '';
  for (const body of bodies) {
    let res;
    try {
      res = await postChatCompletions(url, key, body, { timeoutMs: 45000 });
    } catch (err) {
      lastMsg = err.message || String(err);
      continue;
    }
    if (res.ok) {
      return {
        ok: true,
        message: `预检通过：${info.host} / ${info.model}`,
        endpoint: info,
      };
    }
    if (isHtmlGatewayBlock(res.text, res.status)) {
      return {
        ok: false,
        message: formatApiError(res.status, res.text, { url }),
        endpoint: info,
        blocked: true,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        message: formatApiError(res.status, res.text, { url }),
        endpoint: info,
      };
    }
    // 400 on ping often means model name wrong — still report
    lastMsg = formatApiError(res.status, res.text, { url });
    if (res.status === 400) continue;
    if (res.status === 429 || res.status === 503) {
      return { ok: false, message: lastMsg, endpoint: info, blocked: true };
    }
  }

  // /models as last resort (some gateways allow this even if ping shape differs)
  try {
    const res = await httpJson(`${info.root}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      timeoutMs: 20000,
    });
    if (res.ok) {
      return {
        ok: true,
        message: `预检通过（models）：${info.host}。模型「${info.model}」请确保可用`,
        endpoint: info,
        soft: true,
      };
    }
    if (isHtmlGatewayBlock(res.text, res.status)) {
      return {
        ok: false,
        message: formatApiError(res.status, res.text, { url: `${info.root}/models` }),
        endpoint: info,
        blocked: true,
      };
    }
  } catch (_) {}

  return {
    ok: false,
    message: lastMsg || `无法连接 ${info.host}，请检查 Base URL / Key / 模型`,
    endpoint: info,
  };
}

/** OpenAI-compatible provider presets (domestic first). */
const PROVIDER_PRESETS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    vision: false,
    hint: '国内常用。不支持识图：选图后请用文字描述角色',
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-VL-72B-Instruct',
    vision: true,
    hint: '国内；请选带 VL 的识图模型',
  },
  {
    id: 'dashscope',
    label: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-vl-max',
    vision: true,
    hint: '国内兼容模式；qwen-vl-* 可识图',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4v-flash',
    vision: true,
    hint: '国内；识图用 glm-4v / glm-4v-flash',
  },
  {
    id: 'moonshot',
    label: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k-vision-preview',
    vision: true,
    hint: '国内；请选带 vision 的模型',
  },
  {
    id: 'yi',
    label: '零一万物',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    model: 'yi-vision',
    vision: true,
    hint: '国内；识图模型 yi-vision',
  },
  {
    id: 'baichuan',
    label: '百川',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    model: 'Baichuan-M2',
    vision: false,
    hint: '国内 OpenAI 兼容；多数模型不识图，走文字描述',
  },
  {
    id: 'volcengine',
    label: '火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: '',
    vision: true,
    hint: '模型填方舟推理接入点 ID（支持视觉的端点）',
  },
  {
    id: 'hunyuan',
    label: '腾讯混元',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    model: 'hunyuan-vision',
    vision: true,
    hint: '国内；选用 hunyuan-vision 等识图模型',
  },
  {
    id: 'qianfan',
    label: '百度千帆',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    model: 'ernie-4.5-8k-preview',
    vision: false,
    hint: '国内；无识图时走文字描述生成',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    vision: true,
    hint: '海外聚合，可选多种识图模型',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    vision: true,
    hint: '官方接口，国内常需代理',
  },
  {
    id: 'custom',
    label: '自定义',
    baseUrl: '',
    model: '',
    vision: null,
    hint: '任意 OpenAI 兼容 Base URL；不识图会自动改用文字描述',
  },
];

function detectVisionSupport(baseUrl, model) {
  const root = normalizeBaseUrl(baseUrl).toLowerCase();
  const mdl = String(model || '').toLowerCase();

  // Explicit vision model names
  if (
    /(^|\/)(gpt-4o|gpt-4\.1|gpt-4-turbo|gemini|claude-3|claude-sonnet-4)/.test(mdl) ||
    /vl|vision|glm-4v|qwen-vl|yi-vision|hunyuan-vision|step-1v|internvl/.test(mdl)
  ) {
    return { vision: true, reason: '' };
  }

  // Known text-only
  if (/deepseek\.com/.test(root) || /^deepseek-/.test(mdl)) {
    return {
      vision: false,
      reason: 'DeepSeek 当前不支持识图，请用文字描述角色外貌',
    };
  }
  if (/baichuan-ai\.com/.test(root) && !/vision|vl/.test(mdl)) {
    return { vision: false, reason: '当前百川模型可能不支持识图，将用文字描述生成' };
  }
  if (/qianfan\.baidubce\.com/.test(root) && !/vision|vl|image/.test(mdl)) {
    return { vision: false, reason: '当前千帆模型可能不支持识图，将用文字描述生成' };
  }
  if (/^deepseek-chat$|^deepseek-reasoner$/.test(mdl)) {
    return { vision: false, reason: '该模型不支持识图，将用文字描述生成' };
  }

  // Host defaults from presets
  for (const p of PROVIDER_PRESETS) {
    if (!p.baseUrl) continue;
    const pb = normalizeBaseUrl(p.baseUrl).toLowerCase();
    if (root === pb || root.startsWith(pb + '/')) {
      if (p.vision === false) {
        return { vision: false, reason: p.hint || '当前服务商不支持识图，将用文字描述生成' };
      }
      if (p.vision === true) return { vision: true, reason: '' };
    }
  }

  // Unknown: try vision, allow auto fallback
  return { vision: 'auto', reason: '' };
}

function isVisionRejectedError(err) {
  const msg = String(err && err.message ? err.message : err || '').toLowerCase();
  return /image|vision|multimodal|不支持.*图|识图|content\[|invalid.*message|unknown variant|does not support|not support.*image|图片/.test(
    msg
  );
}

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

/** Normalize OpenAI-compatible API root (no trailing slash). */
function normalizeBaseUrl(baseUrl) {
  let root = String(baseUrl || DEFAULT_BASE).trim();
  if (!root) root = DEFAULT_BASE;
  root = root.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(root)) {
    root = root.replace(/\/chat\/completions$/i, '');
  }
  root = root.replace(/\/+$/, '');

  // Already has an API version segment — keep it
  if (
    /\/v\d+$/i.test(root) ||
    /\/compatible-mode\/v1$/i.test(root) ||
    /\/api\/paas\/v\d+$/i.test(root) ||
    /\/api\/v\d+$/i.test(root)
  ) {
    return root;
  }

  const host = root.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();

  // Host-specific roots used by domestic providers
  if (host === 'api.deepseek.com') return `${root}/v1`;
  if (host === 'open.bigmodel.cn') return `${root}/api/paas/v4`;
  if (host === 'ark.cn-beijing.volces.com' || host.endsWith('.volces.com')) {
    return root.includes('/api/') ? root : `${root}/api/v3`;
  }
  if (host === 'dashscope.aliyuncs.com') return `${root}/compatible-mode/v1`;
  if (host === 'qianfan.baidubce.com') return `${root}/v2`;

  return `${root}/v1`;
}

function imageToDataUrl(imagePath, { maxSide = 1024, quality = 78 } = {}) {
  let buf;
  let mime = mimeFromPath(imagePath);
  try {
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromPath(imagePath);
    if (!img || img.isEmpty()) throw new Error('empty');
    const size = img.getSize();
    const longest = Math.max(size.width, size.height);
    let ni = img;
    if (longest > maxSide) {
      const scale = maxSide / longest;
      ni = img.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'better',
      });
    }
    buf = ni.toJPEG(quality);
    mime = 'image/jpeg';
  } catch (_) {
    buf = fs.readFileSync(imagePath);
  }
  // Cap ~1.2MB base64 payload to reduce gateway blocks
  if (buf.length > 900000 && mime === 'image/jpeg') {
    try {
      const { nativeImage } = require('electron');
      const img = nativeImage.createFromPath(imagePath);
      const size = img.getSize();
      const scale = 720 / Math.max(size.width, size.height, 1);
      const ni = img.resize({
        width: Math.max(1, Math.round(size.width * Math.min(1, scale))),
        height: Math.max(1, Math.round(size.height * Math.min(1, scale))),
        quality: 'good',
      });
      buf = ni.toJPEG(70);
    } catch (_) {}
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
  const end = s.lastIndexOf('</svg>');
  if (end >= 0) s = s.slice(0, end + 6);
  if (!/<svg[\s\S]*<\/svg>/i.test(s)) return '';
  if (!/viewBox=/i.test(s)) {
    s = s.replace(/<svg\b/i, `<svg viewBox="0 0 ${VIEW_W} ${VIEW_H}"`);
  }
  // Drop huge embedded rasters that bloat themes
  if (/data:image\/[^"']{200,}/i.test(s) && s.length > 80000) {
    return '';
  }
  return s;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfterMs(res) {
  try {
    const j = JSON.parse(res.text || '{}');
    const ra = j.error?.retry_after ?? j.retry_after;
    if (typeof ra === 'number' && ra > 0) return Math.min(60000, ra * (ra < 100 ? 1000 : 1));
  } catch (_) {}
  return 0;
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
          Accept: 'application/json',
          'User-Agent': 'BlackHoleRecycleBin/1.1 theme-from-image',
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
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode || 0,
            text,
            headers: res.headers || {},
          });
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

async function postChatCompletions(url, apiKey, body, { timeoutMs = 180000 } = {}) {
  return httpJson(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
    timeoutMs,
  });
}

function stripErrorDetail(text, { host } = {}) {
  let detail = String(text || '').trim();
  if (!detail) return '';
  if (/^\s*<!DOCTYPE\s+html/i.test(detail) || /<html[\s>]/i.test(detail)) {
    const title = detail.match(/<title[^>]*>([^<]*)<\/title>/i);
    const titleText = title?.[1]?.replace(/\s+/g, ' ').trim();
    const risky = RISKY_HOST_RE.test(host || '');
    if (
      /request\s*blocked|access\s*denied|just a moment|cloudflare|禁止访问|被拦截/i.test(detail) ||
      /request\s*blocked|access\s*denied/i.test(titleText || '')
    ) {
      if (risky) {
        return (
          `${host || '该海外接口'} 被网关拦截（常见于国内直连）。` +
          '请到「AI 设置」改选 DeepSeek / 硅基流动 / 百炼 / 智谱等国内预设，并使用对应服务商的 Key'
        );
      }
      return `请求被网关拦截${host ? `（${host}）` : ''}。请检查 Base URL / Key，或换国内服务商预设`;
    }
    if (titleText) return titleText.slice(0, 120);
    return '服务返回了网页错误页，请检查 Base URL 是否正确';
  }
  try {
    const j = JSON.parse(detail);
    detail = j.error?.message || j.message || detail;
  } catch (_) {}
  return String(detail).replace(/\s+/g, ' ').trim().slice(0, 280);
}

function formatApiError(status, text, { url } = {}) {
  let host = '';
  try {
    host = url ? new URL(url).host : '';
  } catch (_) {}
  const detail = stripErrorDetail(text, { host });
  const where = host ? ` @ ${host}` : '';
  if (status === 401 || status === 403) {
    return detail
      ? `API Key 无效或无权限（${status}${where}）：${detail}`
      : `API Key 无效或无权限（${status}${where}）`;
  }
  if (status === 402 || status === 429) {
    return detail
      ? `额度不足、限流或被拦截（${status}${where}）：${detail}`
      : `额度不足、限流或被拦截（${status}${where}）。可稍后再试或更换服务商`;
  }
  if (status === 404) {
    return `接口不存在（404${where}）。DeepSeek 请用 https://api.deepseek.com/v1`;
  }
  return detail
    ? `AI 请求失败（HTTP ${status}${where}）：${detail}`
    : `AI 请求失败（HTTP ${status}${where}）`;
}

function contentFromResponse(data) {
  const msg = data?.choices?.[0]?.message;
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((p) => (typeof p === 'string' ? p : p?.text || ''))
      .join('\n');
  }
  return '';
}

/**
 * Chat with retries, JSON-mode fallback, and max_tokens / max_completion_tokens fallback.
 */
async function chatJson({ apiKey, baseUrl, model, messages, maxTokens = 4000, temperature = 0.35, timeoutMs = 180000 }) {
  const root = normalizeBaseUrl(baseUrl);
  const url = `${root}/chat/completions`;
  const mdl = String(model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const plainFirst = preferPlainChatFirst(root);

  // Domestic / OpenRouter: plain body first (response_format often rejected or blocked)
  const withJsonMode = {
    model: mdl,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages,
  };
  const withCompletionTokens = {
    model: mdl,
    temperature,
    max_completion_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages,
  };
  const plain = {
    model: mdl,
    temperature,
    max_tokens: Math.min(maxTokens, plainFirst ? 8192 : maxTokens),
    messages,
  };
  const attemptBodies = plainFirst
    ? [plain, withJsonMode, withCompletionTokens]
    : [withJsonMode, withCompletionTokens, plain];

  let lastErr = null;
  for (let round = 0; round < 4; round++) {
    const body = attemptBodies[Math.min(round, attemptBodies.length - 1)];
    let res;
    try {
      res = await postChatCompletions(url, apiKey, body, { timeoutMs });
    } catch (err) {
      lastErr = err;
      if (round < 3) {
        await sleep(800 * (round + 1));
        continue;
      }
      throw err;
    }

    // HTML gateway pages never recover by retrying the same blocked host
    if (isHtmlGatewayBlock(res.text, res.status)) {
      throw new Error(formatApiError(res.status || 429, res.text, { url }));
    }

    if (res.ok) {
      let data;
      try {
        data = JSON.parse(res.text);
      } catch (_) {
        throw new Error('AI 返回了无法解析的响应');
      }
      const content = contentFromResponse(data);
      if (!content) throw new Error('AI 没有返回内容，请换识图模型或检查额度');
      return extractJson(content);
    }

    // Unsupported params → try next body shape
    if (
      res.status === 400 &&
      /response_format|json_object|max_tokens|max_completion_tokens|unsupported/i.test(res.text || '')
    ) {
      lastErr = new Error(formatApiError(res.status, res.text, { url }));
      continue;
    }

    // Rate limit / soft block → backoff (JSON errors only)
    if (res.status === 429 || res.status === 503) {
      const wait = parseRetryAfterMs(res) || 1500 * (round + 1);
      lastErr = new Error(formatApiError(res.status, res.text, { url }));
      if (round < 3) {
        await sleep(wait);
        continue;
      }
      throw lastErr;
    }

    throw new Error(formatApiError(res.status, res.text, { url }));
  }
  throw lastErr || new Error('AI 请求失败');
}

async function analyzeCharacter({ apiKey, baseUrl, model, dataUrl, description }) {
  if (dataUrl) {
    return chatJson({
      apiKey,
      baseUrl,
      model,
      maxTokens: 900,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content:
            '你是桌宠角色分析师。根据参考图输出 JSON（不要 markdown）：' +
            '{"name":"简短中文名","eatLabel":"2-6字称呼","toastOk":"成功短句","toastFail":"失败短句",' +
            '"species":"动物或角色类型","palette":["#rrggbb",...],"traits":"外形特征简述30-80字","pose":"默认姿态"}',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: '分析这张图的角色，供后续绘制 SVG 桌宠使用。' },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
          ],
        },
      ],
    });
  }

  const desc = String(description || '').trim();
  if (!desc) throw new Error('请填写角色文字描述（当前接口不支持识图）');
  return chatJson({
    apiKey,
    baseUrl,
    model,
    maxTokens: 900,
    temperature: 0.35,
    messages: [
      {
        role: 'system',
        content:
          '你是桌宠角色设定师。根据用户文字描述输出 JSON（不要 markdown）：' +
          '{"name":"简短中文名","eatLabel":"2-6字称呼","toastOk":"成功短句","toastFail":"失败短句",' +
          '"species":"动物或角色类型","palette":["#rrggbb",...],"traits":"外形特征简述40-100字","pose":"默认姿态"}',
      },
      {
        role: 'user',
        content: `请把下面描述整理成桌宠角色设定：\n${desc}`,
      },
    ],
  });
}

async function generateIdleSvg({ apiKey, baseUrl, model, dataUrl, brief }) {
  const briefText = JSON.stringify({
    name: brief.name,
    species: brief.species,
    palette: brief.palette,
    traits: brief.traits,
    pose: brief.pose,
  });
  const system =
    `你是桌宠 SVG 画师。输出 JSON：{"svg":"<svg ...>...</svg>"}。` +
    `要求：完整合法 SVG；viewBox="0 0 ${VIEW_W} ${VIEW_H}"；透明背景；角色居中；` +
    `清晰矢量卡通；不要外链图片；不要 base64 大图；不要 markdown。`;

  const userContent = dataUrl
    ? [
        { type: 'text', text: `绘制待机 idle SVG。角色资料：${briefText}` },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
      ]
    : `根据角色资料绘制待机 idle SVG（仅文字，无参考图）：${briefText}`;

  const parsed = await chatJson({
    apiKey,
    baseUrl,
    model,
    maxTokens: 5000,
    temperature: 0.35,
    timeoutMs: 200000,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
  });
  const svg = cleanSvg(parsed.svg || parsed.idle || '');
  if (!svg) throw new Error('未能生成有效的待机 SVG，请换模型或补充更详细的角色描述');
  return svg;
}

async function generateVariantSvg({ apiKey, baseUrl, model, idleSvg, brief, kind }) {
  const kindHint = {
    'eat-open': '张嘴准备吃文件，嘴巴明显张开，表情期待',
    'eat-chew': '正在咀嚼，嘴巴微动/鼓腮，可爱',
    poke: '被戳一下的反应，略惊讶或开心晃一下',
    drag: '被拖拽时的表情，可略带无奈或专注',
  }[kind];

  const parsed = await chatJson({
    apiKey,
    baseUrl,
    model,
    maxTokens: 4500,
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content:
          `你是桌宠 SVG 画师。基于给定 idle SVG 改一帧表情/姿态。` +
          `输出 JSON：{"svg":"<svg ...>...</svg>"}。保持同一角色、配色、体型与 viewBox="0 0 ${VIEW_W} ${VIEW_H}"；` +
          `透明背景；不要外链/base64 大图；不要 markdown。`,
      },
      {
        role: 'user',
        content:
          `角色：${brief.name || ''}（${brief.traits || ''}）\n` +
          `目标状态：${kind} — ${kindHint}\n` +
          `参考 idle SVG：\n${idleSvg.slice(0, 12000)}`,
      },
    ],
  });
  return cleanSvg(parsed.svg || '') || idleSvg;
}

/** Lightweight real API probe — same path as generation preflight. */
async function testAiConnection({ apiKey, baseUrl, model } = {}) {
  const result = await preflightAi({ apiKey, baseUrl, model });
  if (!result.ok) return result;
  const info = result.endpoint || assessEndpoint(baseUrl, model);
  if (info.riskyForeign) {
    return {
      ok: true,
      message:
        `${result.message}。注意：${info.host} 在国内可能被网关拦截，建议改用 DeepSeek / 硅基流动 / 百炼等预设`,
      endpoint: info,
    };
  }
  if (info.vision === false) {
    return {
      ok: true,
      message: `${result.message}。该模型不识图：生成主题时请填写角色文字描述`,
      endpoint: info,
    };
  }
  return {
    ok: true,
    message: `${result.message}。识图失败时会自动改用已填的文字描述`,
    endpoint: info,
  };
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

  const idlePath = path.join(assetsDir, 'idle.svg');
  for (const opt of ['poke.svg', 'drag.svg', 'eat-chew.svg', 'eat-open.svg']) {
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
 * @param {string} imagePath — optional when using text-only providers
 * @param {string} userThemesDir
 * @param {{ apiKey: string, baseUrl?: string, model?: string, name?: string, description?: string, forceText?: boolean }} ai
 * @param {(step: string) => void} [onProgress]
 */
async function createThemeFromImage(imagePath, userThemesDir, ai = {}, onProgress = null) {
  const progress = (msg) => {
    try {
      if (typeof onProgress === 'function') onProgress(msg);
    } catch (_) {}
  };

  try {
    if (!userThemesDir) throw new Error('用户主题目录不可用');
    const apiKey = String(ai.apiKey || '').trim();
    if (!apiKey) throw new Error('请先填写 AI API Key（托盘 → 皮肤 → AI 设置）');

    const baseUrl = normalizeBaseUrl(ai.baseUrl);
    const model = String(ai.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const description = String(ai.description || '').trim();
    const cap = detectVisionSupport(baseUrl, model);
    let useVision = ai.forceText ? false : cap.vision === true || cap.vision === 'auto';
    if (cap.vision === false) useVision = false;

    let dataUrl = null;
    if (useVision) {
      if (!imagePath || !fs.existsSync(imagePath)) {
        throw new Error('识图模式需要选择一张有效图片');
      }
      progress('压缩参考图…');
      dataUrl = imageToDataUrl(imagePath);
    } else if (!description) {
      throw new Error(
        cap.reason ||
          '当前接口不支持识图（如 DeepSeek），请填写角色文字描述后再生成'
      );
    }

    let brief;
    progress(useVision ? '分析角色特征（识图）…' : '根据文字描述整理角色…');
    try {
      brief = await analyzeCharacter({
        apiKey,
        baseUrl,
        model,
        dataUrl: useVision ? dataUrl : null,
        description,
      });
    } catch (err) {
      if (
        useVision &&
        description &&
        (isVisionRejectedError(err) ||
          /429|400|403|503|blocked|网关拦截|不支持.*图|vision|image/i.test(String(err.message)))
      ) {
        progress('识图不可用，改用文字描述…');
        useVision = false;
        dataUrl = null;
        brief = await analyzeCharacter({ apiKey, baseUrl, model, dataUrl: null, description });
      } else if (useVision && !description) {
        throw new Error(
          `${err.message}\n\n识图失败且未填写文字描述。请换 VL 模型，或补充角色描述后重试。`
        );
      } else {
        throw err;
      }
    }

    progress('绘制待机造型…');
    let idle;
    try {
      idle = await generateIdleSvg({
        apiKey,
        baseUrl,
        model,
        dataUrl: useVision ? dataUrl : null,
        brief,
      });
    } catch (err) {
      if (
        useVision &&
        description &&
        (isVisionRejectedError(err) ||
          /429|400|403|503|blocked|网关拦截|vision|image/i.test(String(err.message)))
      ) {
        progress('识图绘制失败，改用文字描述重绘…');
        useVision = false;
        idle = await generateIdleSvg({
          apiKey,
          baseUrl,
          model,
          dataUrl: null,
          brief,
        });
      } else {
        throw err;
      }
    }

    const assets = { idle };
    const variants = ['eat-open', 'eat-chew', 'poke', 'drag'];
    for (let i = 0; i < variants.length; i++) {
      const kind = variants[i];
      progress(`绘制表情 ${i + 1}/${variants.length}（${kind}）…`);
      try {
        assets[kind] = await generateVariantSvg({
          apiKey,
          baseUrl,
          model,
          idleSvg: idle,
          brief,
          kind,
        });
        await sleep(350);
      } catch (err) {
        assets[kind] = idle;
        progress(`「${kind}」失败，已用待机代替`);
      }
    }

    progress('写入主题包…');
    const fallbackName = imagePath
      ? path.basename(imagePath, path.extname(imagePath))
      : 'ai-pet';
    const nameHint = String(ai.name || brief.name || fallbackName).slice(0, 40);
    const themeId = uniqueThemeId(userThemesDir, nameHint);
    const dest = path.join(userThemesDir, themeId);
    fs.mkdirSync(dest, { recursive: true });

    const name = writeThemeFromAi(dest, themeId, {
      name: nameHint,
      eatLabel: brief.eatLabel,
      toastOk: brief.toastOk,
      toastFail: brief.toastFail,
      assets,
    });
    progress('完成');
    return { status: 'ok', themeId, name, path: dest, mode: useVision ? 'vision' : 'text' };
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
  preflightAi,
  assessEndpoint,
  normalizeBaseUrl,
  detectVisionSupport,
  DEFAULT_BASE,
  DEFAULT_MODEL,
  PROVIDER_PRESETS,
};
