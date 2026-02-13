const crypto = require('node:crypto');

function normalizePart(value, maxLength = 256) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim().toLowerCase().slice(0, maxLength);
}

function hashFingerprint(rawValue) {
  return crypto.createHash('sha256').update(String(rawValue || '')).digest('hex');
}

function sanitizeExplicitFingerprint(value) {
  const normalized = normalizePart(value, 512);
  if (!normalized) {
    return '';
  }

  return hashFingerprint(normalized);
}

function buildDeviceFingerprint({
  explicitFingerprint,
  userAgent,
  acceptLanguage,
  secChUa,
  secChUaPlatform,
  secChUaMobile,
  clientIp,
  protocolHint
} = {}) {
  const explicit = sanitizeExplicitFingerprint(explicitFingerprint);
  if (explicit) {
    return explicit;
  }

  const normalizedUserAgent = normalizePart(userAgent, 512);
  const parts = [
    `ua:${normalizedUserAgent}`,
    `lang:${normalizePart(acceptLanguage, 128)}`,
    `chua:${normalizePart(secChUa, 256)}`,
    `platform:${normalizePart(secChUaPlatform, 64)}`,
    `mobile:${normalizePart(secChUaMobile, 16)}`,
    `hint:${normalizePart(protocolHint, 64)}`
  ];

  // Fallback for agents without usable headers.
  if (!normalizedUserAgent) {
    parts.push(`ip:${normalizePart(clientIp, 64)}`);
  }

  return hashFingerprint(parts.join('|'));
}

function shortFingerprint(fingerprint, length = 12) {
  const normalized = normalizePart(fingerprint, 128);
  if (!normalized) {
    return '';
  }

  return normalized.slice(0, Math.max(4, length));
}

module.exports = {
  buildDeviceFingerprint,
  shortFingerprint
};
