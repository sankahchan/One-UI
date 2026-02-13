const crypto = require('node:crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(encoded) {
  let bits = 0;
  let value = 0;
  const output = [];
  const normalized = String(encoded).toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      continue;
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

function leftPad(value, length) {
  const raw = String(value);
  if (raw.length >= length) {
    return raw;
  }

  return '0'.repeat(length - raw.length) + raw;
}

class TotpService {
  generateSecret(bytes = 20) {
    return base32Encode(crypto.randomBytes(bytes));
  }

  generateOtp(secret, { time = Date.now(), step = 30, digits = 6 } = {}) {
    const secretBuffer = base32Decode(secret);
    const counter = Math.floor(time / 1000 / step);
    const counterBuffer = Buffer.alloc(8);

    let tempCounter = counter;
    for (let index = 7; index >= 0; index -= 1) {
      counterBuffer[index] = tempCounter & 0xff;
      tempCounter >>= 8;
    }

    const hmac = crypto
      .createHmac('sha1', secretBuffer)
      .update(counterBuffer)
      .digest();

    const offset = hmac[hmac.length - 1] & 0xf;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);

    const otp = binary % (10 ** digits);
    return leftPad(otp, digits);
  }

  verifyOtp(secret, token, { window = 1, step = 30, digits = 6 } = {}) {
    if (!secret || !token) {
      return false;
    }

    const normalizedToken = String(token).trim();
    const now = Date.now();

    for (let offset = -window; offset <= window; offset += 1) {
      const time = now + offset * step * 1000;
      const expected = this.generateOtp(secret, { time, step, digits });
      if (expected === normalizedToken) {
        return true;
      }
    }

    return false;
  }

  getOtpAuthUrl({ issuer, accountName, secret }) {
    const encodedIssuer = encodeURIComponent(issuer);
    const encodedAccount = encodeURIComponent(accountName);
    return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
  }
}

module.exports = new TotpService();
