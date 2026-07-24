/**
 * Discover and load built-in + user pet/blackhole themes.
 */
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');

const RESERVED_IDS = new Set(['blackhole', 'calico', 'template']);
const HIDDEN_IDS = new Set(['template']);

const DEFAULT_TIMINGS = {
  idleAnim: 5200,
  yawning: 4000,
  dozing: 4000,
  collapsing: 3500,
  waking: 2500,
  thinking: 4000,
  working: 4000,
  juggling: 4000,
  building: 4000,
  conducting: 4000,
  sweeping: 4000,
  carrying: 4000,
  error: 4000,
  attention: 4000,
  notification: 4000,
  reactDrag: 1600,
  reactPoke: 1400,
  eatOpen: 0,
  eatChew: 1600,
};

let appRoot = null;
let userThemesDir = null;

function init(rootDir, userDataDir) {
  appRoot = rootDir;
  userThemesDir = path.join(userDataDir, 'themes');
  ensureUserThemesDir();
}

function builtinThemesDir() {
  return path.join(appRoot, 'themes');
}

function getUserThemesDir() {
  return userThemesDir;
}

function ensureUserThemesDir() {
  if (!userThemesDir) return;
  fs.mkdirSync(userThemesDir, { recursive: true });
  return userThemesDir;
}

function openUserThemesFolder() {
  ensureUserThemesDir();
  return shell.openPath(userThemesDir);
}

function readThemeJson(dir) {
  const file = path.join(dir, 'theme.json');
  if (!fs.existsSync(file)) return null;
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function resolveStateEntry(entry) {
  if (!entry) return { files: [], fallbackTo: null };
  if (Array.isArray(entry)) return { files: entry, fallbackTo: null };
  if (typeof entry === 'string') return { files: [entry], fallbackTo: null };
  if (typeof entry === 'object') {
    const files = Array.isArray(entry.files) ? entry.files : entry.file ? [entry.file] : [];
    return { files, fallbackTo: entry.fallbackTo || null };
  }
  return { files: [], fallbackTo: null };
}

function firstExistingFile(assetsDir, files) {
  for (const f of files || []) {
    if (!f || typeof f !== 'string') continue;
    const base = path.basename(f);
    const full = path.join(assetsDir, base);
    if (fs.existsSync(full)) return base;
  }
  return null;
}

function normalizeTheme(id, raw, themeDir, source) {
  if (!raw || raw._scaffoldOnly) return null;
  const type = raw.type === 'blackhole' ? 'blackhole' : 'pet';
  const viewBox = raw.viewBox || { width: 1, height: 1 };
  const vw = Number(viewBox.width) || 1;
  const vh = Number(viewBox.height) || 1;
  const assetsDir = type === 'blackhole' ? themeDir : path.join(themeDir, 'assets');
  const statesRaw = raw.states || {};
  const resolved = {};

  for (const [key, entry] of Object.entries(statesRaw)) {
    const { files, fallbackTo } = resolveStateEntry(entry);
    const file = type === 'blackhole' ? null : firstExistingFile(assetsDir, files);
    resolved[key] = {
      file,
      files,
      fallbackTo,
      missing: type === 'pet' && !file && !fallbackTo,
    };
  }

  // Resolve fallbacks to concrete files
  function resolveKey(key, seen = new Set()) {
    if (!key || seen.has(key)) return null;
    seen.add(key);
    const st = resolved[key];
    if (!st) return null;
    if (st.file) return st.file;
    if (st.fallbackTo) return resolveKey(st.fallbackTo, seen);
    return null;
  }

  const assetMap = {};
  for (const key of Object.keys(resolved)) {
    assetMap[key] = resolveKey(key);
  }
  if (!assetMap.idle && type === 'pet') {
    // require idle
    return null;
  }

  const timings = { ...DEFAULT_TIMINGS, ...(raw.timings || {}) };
  const sleepSequence = raw.sleepSequence || { mode: type === 'pet' ? 'direct' : 'full' };

  // Relative URL base for renderer (file:// via loadFile resolves against app root for builtins)
  let assetBase;
  if (type === 'blackhole') {
    assetBase = null;
  } else if (source === 'builtin') {
    assetBase = `themes/${id}/assets/`;
  } else {
    // User themes served via custom protocol or absolute file URL
    assetBase = pathToFileUrl(path.join(themeDir, 'assets')) + '/';
  }

  return {
    id,
    name: raw.name || id,
    author: raw.author || '',
    description: raw.description || '',
    type,
    source,
    themeDir,
    assetsDir: type === 'pet' ? assetsDir : themeDir,
    assetBase,
    viewBox: { width: vw, height: vh },
    aspect: vh / vw,
    states: resolved,
    assetMap,
    timings,
    sleepSequence,
    eatLabel: raw.eatLabel || (id === 'calico' ? '小猫' : '宠物'),
    toastOk: raw.toastOk || null,
    toastFail: raw.toastFail || null,
  };
}

function pathToFileUrl(p) {
  const resolved = path.resolve(p).replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(resolved)) {
    return 'file:///' + resolved;
  }
  return 'file://' + resolved;
}

function scanDir(root, source, into) {
  if (!root || !fs.existsSync(root)) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const id = ent.name;
    if (HIDDEN_IDS.has(id)) continue;
    if (id.startsWith('.') || id.startsWith('_')) continue;
    if (source === 'user' && RESERVED_IDS.has(id) && id !== 'template') {
      // Allow user override only for non-reserved; reserved always builtin
      continue;
    }
    const themeDir = path.join(root, id);
    const raw = readThemeJson(themeDir);
    if (!raw || raw._scaffoldOnly) continue;
    const theme = normalizeTheme(id, raw, themeDir, source);
    if (!theme) continue;
    if (source === 'builtin' || !into.has(id)) {
      into.set(id, theme);
    }
  }
}

function discoverThemes() {
  const map = new Map();
  scanDir(builtinThemesDir(), 'builtin', map);
  scanDir(userThemesDir, 'user', map);
  // Ensure blackhole exists even without folder (legacy)
  if (!map.has('blackhole')) {
    map.set('blackhole', {
      id: 'blackhole',
      name: '黑洞',
      type: 'blackhole',
      source: 'builtin',
      aspect: 1,
      assetBase: null,
      assetMap: {},
      timings: DEFAULT_TIMINGS,
      sleepSequence: { mode: 'direct' },
      eatLabel: '黑洞',
    });
  }
  return map;
}

function listThemes() {
  const map = discoverThemes();
  return [...map.values()]
    .filter((t) => !HIDDEN_IDS.has(t.id))
    .sort((a, b) => {
      const order = { blackhole: 0, calico: 1 };
      const ao = order[a.id] != null ? order[a.id] : 10;
      const bo = order[b.id] != null ? order[b.id] : 10;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name, 'zh');
    })
    .map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      source: t.source,
      description: t.description || '',
    }));
}

function loadTheme(id) {
  const map = discoverThemes();
  return map.get(id) || map.get('blackhole') || null;
}

function themePayload(theme) {
  if (!theme) return null;
  return {
    theme: theme.id,
    id: theme.id,
    name: theme.name,
    type: theme.type,
    assetBase: theme.assetBase,
    assetMap: theme.assetMap || {},
    timings: theme.timings || DEFAULT_TIMINGS,
    sleepSequence: theme.sleepSequence || { mode: 'direct' },
    aspect: theme.aspect != null ? theme.aspect : 1,
    eatLabel: theme.eatLabel,
    toastOk: theme.toastOk,
    toastFail: theme.toastFail,
  };
}

module.exports = {
  init,
  ensureUserThemesDir,
  getUserThemesDir,
  openUserThemesFolder,
  discoverThemes,
  listThemes,
  loadTheme,
  themePayload,
  DEFAULT_TIMINGS,
};
