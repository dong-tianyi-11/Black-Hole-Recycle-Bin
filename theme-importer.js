/**
 * User theme zip import — adapted from clawd-on-desk (simplified).
 * Zip must contain exactly one theme.json at root or one folder deep.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const extract = require('extract-zip');

const MAX_THEME_ZIP_BYTES = 80 * 1024 * 1024;
const RESERVED_THEME_IDS = new Set(['blackhole', 'calico', 'template']);

function sanitizeThemeDirName(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 80);
  return cleaned || '';
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function chooseThemeRoot(extractDir) {
  const files = walkFiles(extractDir);
  const themeJsons = files.filter((f) => path.basename(f).toLowerCase() === 'theme.json');
  if (themeJsons.length !== 1) {
    throw new Error('主题包须在根目录或一层子文件夹内包含且仅包含一个 theme.json');
  }
  const tj = themeJsons[0];
  const rel = path.relative(extractDir, tj);
  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.length === 1) {
    return { root: extractDir, folderName: '' };
  }
  if (parts.length === 2) {
    return { root: path.dirname(tj), folderName: parts[0] };
  }
  throw new Error('theme.json 只能在 zip 根目录或一层子文件夹内');
}

function readJson(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}

function validateTheme(raw, root) {
  if (!raw || typeof raw !== 'object') throw new Error('无效的 theme.json');
  if (raw._scaffoldOnly) throw new Error('不能导入带 _scaffoldOnly 的脚手架主题');
  const type = raw.type === 'blackhole' ? 'blackhole' : 'pet';
  if (type === 'blackhole') throw new Error('用户主题仅支持 type: pet');
  const states = raw.states || {};
  if (!states.idle) throw new Error('theme.json 缺少必填状态 idle');
  if (!states.eatOpen && !states.eatChew) {
    throw new Error('theme.json 建议至少提供 eatOpen / eatChew（吃文件动画）');
  }
  const assetsDir = path.join(root, 'assets');
  if (!fs.existsSync(assetsDir)) throw new Error('缺少 assets/ 目录');

  const missing = [];
  for (const [key, entry] of Object.entries(states)) {
    let files = [];
    if (Array.isArray(entry)) files = entry;
    else if (typeof entry === 'string') files = [entry];
    else if (entry && Array.isArray(entry.files)) files = entry.files;
    else if (entry && entry.fallbackTo) continue;
    const found = files.some((f) => f && fs.existsSync(path.join(assetsDir, path.basename(f))));
    if (files.length && !found && (key === 'idle' || key === 'eatOpen' || key === 'eatChew')) {
      missing.push(`${key}: ${files.join('|')}`);
    }
  }
  if (missing.length) throw new Error(`缺少资源文件：${missing.join(', ')}`);
  return raw;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function rmDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

/**
 * @returns {{ status: 'ok'|'error', themeId?: string, name?: string, message?: string, path?: string }}
 */
async function importUserThemeZip(zipPath, userThemesDir) {
  try {
    if (!userThemesDir) throw new Error('用户主题目录不可用');
    if (!zipPath || !fs.existsSync(zipPath)) throw new Error('未选择有效的 zip 文件');
    const stat = fs.statSync(zipPath);
    if (!stat.isFile()) throw new Error('所选路径不是文件');
    if (stat.size > MAX_THEME_ZIP_BYTES) throw new Error('主题包超过 80MB');

    fs.mkdirSync(userThemesDir, { recursive: true });
    const staging = path.join(
      os.tmpdir(),
      `bh-theme-import-${process.pid}-${Date.now()}`
    );
    rmDir(staging);
    fs.mkdirSync(staging, { recursive: true });

    try {
      await extract(zipPath, { dir: staging });
      const { root, folderName } = chooseThemeRoot(staging);
      const fallback = path.basename(zipPath, path.extname(zipPath));
      const themeId = sanitizeThemeDirName(folderName || fallback);
      if (!themeId) throw new Error('无法从压缩包推导主题 id');
      if (RESERVED_THEME_IDS.has(themeId.toLowerCase())) {
        throw new Error(`主题 id「${themeId}」为内置保留名，请换一个文件夹名`);
      }

      const raw = validateTheme(readJson(path.join(root, 'theme.json')), root);
      const dest = path.join(userThemesDir, themeId);
      if (fs.existsSync(dest)) {
        throw new Error(`主题「${themeId}」已存在，请先删除或改名后再导入`);
      }

      copyDir(root, dest);
      // Ensure id field matches folder
      try {
        const tj = path.join(dest, 'theme.json');
        const j = readJson(tj);
        j.id = themeId;
        delete j._scaffoldOnly;
        fs.writeFileSync(tj, JSON.stringify(j, null, 2), 'utf8');
      } catch (_) {}

      return {
        status: 'ok',
        themeId,
        name: raw.name || themeId,
        path: dest,
      };
    } finally {
      rmDir(staging);
    }
  } catch (err) {
    return {
      status: 'error',
      message: (err && err.message) || String(err),
    };
  }
}

/**
 * Scaffold a new theme folder from built-in template.
 */
function createThemeScaffold(userThemesDir, templateSrc, themeId, options = {}) {
  const id = sanitizeThemeDirName(themeId);
  if (!id) throw new Error('主题 id 无效');
  if (RESERVED_THEME_IDS.has(id.toLowerCase())) {
    throw new Error(`主题 id「${id}」为保留名`);
  }
  if (!userThemesDir || !fs.existsSync(templateSrc)) {
    throw new Error('模板或用户主题目录不可用');
  }
  const dest = path.join(userThemesDir, id);
  if (fs.existsSync(dest)) throw new Error(`主题「${id}」已存在`);
  copyDir(templateSrc, dest);
  const tj = path.join(dest, 'theme.json');
  const raw = readJson(tj);
  delete raw._scaffoldOnly;
  delete raw._comment;
  raw.id = id;
  raw.name = options.name || id;
  if (options.author) raw.author = options.author;
  fs.writeFileSync(tj, JSON.stringify(raw, null, 2), 'utf8');
  return { themeId: id, path: dest, name: raw.name };
}

function removeUserTheme(userThemesDir, themeId) {
  const id = sanitizeThemeDirName(themeId);
  if (!id || RESERVED_THEME_IDS.has(id.toLowerCase())) {
    throw new Error('不能删除内置主题');
  }
  const dest = path.join(userThemesDir, id);
  if (!fs.existsSync(dest)) throw new Error('主题不存在');
  rmDir(dest);
  return true;
}

module.exports = {
  importUserThemeZip,
  createThemeScaffold,
  removeUserTheme,
  sanitizeThemeDirName,
  RESERVED_THEME_IDS,
};
