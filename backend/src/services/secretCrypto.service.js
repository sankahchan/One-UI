const crypto = require('node:crypto');

const env = require('../config/env');
const logger = require('../config/logger');

const PREFIX = 'enc:v1:';
const IV_BYTES = 12;

function normalizeKey(rawKey) {
  const value = String(rawKey || '').trim();
  if (!value) {
    return null;
  }

  if (value.startsWith('base64:')) {
    const decoded = Buffer.from(value.slice('base64:'.length), 'base64');
    if (decoded.length !== 32) {
      return null;
    }
    return decoded;
  }

  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, 'hex');
  }

  try {
    const asBase64 = Buffer.from(value, 'base64');
    if (asBase64.length === 32 && asBase64.toString('base64') === value.replace(/\s+/g, '')) {
      return asBase64;
    }
  } catch (_error) {
    // no-op: fallback to hash
  }

  return crypto.createHash('sha256').update(value).digest();
}

class SecretCryptoService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    const configuredKey = process.env.SECRETS_ENCRYPTION_KEY || env.SECRETS_ENCRYPTION_KEY || '';
    const fallbackKey = process.env.JWT_SECRET || env.JWT_SECRET || '';
    this.key = normalizeKey(configuredKey || fallbackKey);

    if (!configuredKey && fallbackKey) {
      logger.info('SECRETS_ENCRYPTION_KEY not set; falling back to JWT_SECRET-derived key');
    }
  }

  isConfigured() {
    return Boolean(this.key);
  }

  isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
  }

  encrypt(plaintext) {
    const value = plaintext === null || plaintext === undefined ? '' : String(plaintext);
    if (!value) {
      return '';
    }

    if (this.isEncrypted(value)) {
      return value;
    }

    if (!this.key) {
      return value;
    }

    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  decrypt(ciphertext, { allowPlaintext = true } = {}) {
    const value = ciphertext === null || ciphertext === undefined ? '' : String(ciphertext);
    if (!value) {
      return '';
    }

    if (!this.isEncrypted(value)) {
      return allowPlaintext ? value : '';
    }

    if (!this.key) {
      throw new Error('SECRETS_ENCRYPTION_KEY is required to decrypt stored secrets');
    }

    const raw = value.slice(PREFIX.length);
    const [ivBase64, tagBase64, encryptedBase64] = raw.split(':');
    if (!ivBase64 || !tagBase64 || !encryptedBase64) {
      throw new Error('Encrypted secret format is invalid');
    }

    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(tagBase64, 'base64');
    const encrypted = Buffer.from(encryptedBase64, 'base64');

    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }

  safeDecrypt(ciphertext, fallback = '') {
    try {
      return this.decrypt(ciphertext);
    } catch (error) {
      logger.warn('Failed to decrypt secret value', {
        message: error.message
      });
      return fallback;
    }
  }
}

module.exports = new SecretCryptoService();
