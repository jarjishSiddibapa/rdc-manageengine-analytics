const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Encryption for the few settings that are secrets (ManageEngine client secret and refresh token, the mail password).
//
// AES-256-GCM with a random 12-byte IV per value. The 32-byte key is generated once, on first use, into backend\.secret (a random key
// file that is git-ignored and readable only by the account running the app). It is never sent to the browser and never part of a
// database backup, so a stolen database dump alone reveals nothing. If the file is lost the encrypted values can no longer be read:
// the app then falls back to backend\.env and Admin -> Connections asks for the values again.
const KEY_FILE = process.env.SECRET_KEY_FILE || path.join(__dirname, '..', '.secret');
const PREFIX = 'enc1';

let key = null;

// Best effort on Windows, where chmod means nothing: remove inherited permissions and keep only the current user.
function restrict(file) {
  try { fs.chmodSync(file, 0o600); } catch { /* not supported on this file system */ }
  if (process.platform !== 'win32') return;
  const user = process.env.USERNAME;
  if (!user) return;
  try {
    spawnSync('icacls', [file, '/inheritance:r', '/grant:r', `${user}:(R,W)`], { windowsHide: true, stdio: 'ignore' });
  } catch { /* the file is still in the app's own folder */ }
}

function loadKey() {
  if (key) return key;
  if (fs.existsSync(KEY_FILE)) {
    const decoded = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
    if (decoded.length !== 32) throw new Error('backend\\.secret is damaged (it must hold a 32-byte key). Restore it from a copy, or delete it to start a new key (saved passwords will then need to be entered again).');
    key = decoded;
    return key;
  }
  const fresh = crypto.randomBytes(32);
  try {
    fs.writeFileSync(KEY_FILE, `${fresh.toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
    restrict(KEY_FILE);
    key = fresh;
  } catch (error) {
    // Two copies of the app starting at the same moment: use the file the other one wrote.
    if (error.code === 'EEXIST') return loadKey();
    throw error;
  }
  return key;
}

// Makes sure the key file exists (called once at start-up so the first save never has to create it).
function ensureKey() { loadKey(); return KEY_FILE; }

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

const isEncrypted = value => typeof value === 'string' && value.startsWith(`${PREFIX}:`);

// Returns the original text, or throws when the value was not written with this key (or was tampered with).
function decrypt(token) {
  const [prefix, iv, tag, data] = String(token).split(':');
  if (prefix !== PREFIX || !iv || !tag || data === undefined) throw new Error('Not an encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, isEncrypted, ensureKey, KEY_FILE };
