/**
 * AES-256-GCM encrypt www.zip → www.vault (magic FBW6).
 * Key derivation MUST match VaultCrypto.DeriveWwwKey().
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const projRoot = path.resolve(__dirname, '..');
const zipPath = path.join(projRoot, 'www.zip');
const vaultPath = path.join(projRoot, 'www.vault');

const MAGIC = Buffer.from('FBW6', 'ascii');
const material =
  'FlowBrowser.WwwVault.v6|XoxoDigitals|AES-256-GCM|do-not-ship-plaintext-www';
const key = crypto.createHash('sha256').update(material, 'utf8').digest();

if (!fs.existsSync(zipPath)) {
  console.error('[encrypt-www] missing', zipPath);
  process.exit(1);
}

const plain = fs.readFileSync(zipPath);
const nonce = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
const tag = cipher.getAuthTag();
const out = Buffer.concat([MAGIC, nonce, tag, enc]);
fs.writeFileSync(vaultPath, out);
console.log(`[encrypt-www] wrote ${vaultPath} (${out.length} bytes)`);
