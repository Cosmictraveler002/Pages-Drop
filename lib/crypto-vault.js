const crypto = require('crypto');

function getMasterKey() {
  const envKey = process.env.APP_SECRET_KEY;
  if (envKey && envKey.trim().length === 64) {
    return Buffer.from(envKey.trim(), 'hex');
  }
  if (envKey && envKey.trim().length === 32) {
    return Buffer.from(envKey.trim(), 'utf8');
  }

  // Refuse to start if missing in hosted mode
  if (process.env.NODE_ENV === 'production' || process.env.HOSTED === 'true') {
    throw new Error('FATAL: APP_SECRET_KEY (32-byte hex string) must be set in production/hosted mode.');
  }

  // Deterministic local fallback key for offline local development
  return crypto.createHash('sha256').update('cf-pages-local-dev-fallback-key').digest();
}

function encryptSecret(plainText) {
  if (!plainText || typeof plainText !== 'string') return '';
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptSecret(encryptedStr) {
  if (!encryptedStr || typeof encryptedStr !== 'string' || !encryptedStr.includes(':')) {
    return '';
  }
  const parts = encryptedStr.split(':');
  if (parts.length !== 3) return '';

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getMasterKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[CRYPTO] Failed to decrypt secret at rest:', err.message);
    return '';
  }
}

function maskSecret(str) {
  if (!str || typeof str !== 'string') return '';
  if (str.length <= 8) return '****';
  return `${str.substring(0, 4)}...${str.substring(str.length - 4)}`;
}

module.exports = {
  getMasterKey,
  encryptSecret,
  decryptSecret,
  maskSecret
};
