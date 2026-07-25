/**
 * Encrypted API key storage in userData (survives app updates).
 * Uses Electron safeStorage (DPAPI on Windows, Keychain on macOS).
 */
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

const SECRETS_FILE = 'ai-secrets.json';

let userDataDir = '';

function init(userData) {
  userDataDir = userData || '';
}

function secretsPath() {
  if (!userDataDir) throw new Error('ai-secrets not initialized');
  return path.join(userDataDir, SECRETS_FILE);
}

function canEncrypt() {
  try {
    return !!(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable());
  } catch (_) {
    return false;
  }
}

function encrypt(plain) {
  const text = String(plain || '');
  if (!text) return { v: 1, enc: true, data: '' };
  if (canEncrypt()) {
    const buf = safeStorage.encryptString(text);
    return { v: 1, enc: true, data: buf.toString('base64') };
  }
  // Rare fallback (e.g. headless CI) — still not plain JSON next to other settings
  return { v: 1, enc: false, data: Buffer.from(text, 'utf8').toString('base64') };
}

function decrypt(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const data = String(payload.data || '');
  if (!data) return '';
  try {
    if (payload.enc && canEncrypt()) {
      return safeStorage.decryptString(Buffer.from(data, 'base64'));
    }
    return Buffer.from(data, 'base64').toString('utf8');
  } catch (_) {
    return '';
  }
}

function readFile() {
  try {
    const p = secretsPath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeFile(obj) {
  const p = secretsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch (_) {}
}

function getApiKey() {
  const file = readFile();
  if (!file) return '';
  return decrypt(file.apiKey) || '';
}

function setApiKey(apiKey) {
  const key = String(apiKey || '').trim();
  const prev = readFile() || {};
  if (!key) {
    writeFile({ v: 1, apiKey: { v: 1, enc: true, data: '' } });
    return;
  }
  writeFile({
    v: 1,
    ...prev,
    apiKey: encrypt(key),
  });
}

/**
 * Migrate plaintext aiApiKey from config.json into encrypted store, then clear it.
 * @returns {boolean} true if config should drop aiApiKey
 */
function migrateFromConfig(cfg) {
  const plain = String(cfg?.aiApiKey || '').trim();
  if (!plain) return false;
  const existing = getApiKey();
  if (!existing) setApiKey(plain);
  return true;
}

module.exports = {
  init,
  getApiKey,
  setApiKey,
  migrateFromConfig,
  canEncrypt,
};
