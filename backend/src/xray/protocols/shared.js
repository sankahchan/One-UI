function parseJsonArray(raw, fallback = []) {
  if (raw === null || raw === undefined) {
    return fallback;
  }

  if (Array.isArray(raw)) {
    return raw;
  }

  if (typeof raw !== 'string') {
    return fallback;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function parseAlpn(rawAlpn, fallback = ['h2', 'http/1.1']) {
  const alpn = parseJsonArray(rawAlpn, fallback);
  const normalized = alpn
    .map((value) => String(value).trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : fallback;
}

function normalizeFallbackEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const dest = entry.dest !== undefined && entry.dest !== null ? String(entry.dest).trim() : '';
  if (!dest) {
    return null;
  }

  const fallback = { dest };

  if (entry.path !== undefined && entry.path !== null) {
    const path = String(entry.path).trim();
    if (path) {
      fallback.path = path;
    }
  }

  if (entry.alpn !== undefined && entry.alpn !== null) {
    const alpn = Array.isArray(entry.alpn)
      ? entry.alpn.map((value) => String(value).trim()).filter(Boolean)
      : String(entry.alpn).split(',').map((value) => value.trim()).filter(Boolean);
    if (alpn.length > 0) {
      fallback.alpn = alpn;
    }
  }

  if (entry.name !== undefined && entry.name !== null) {
    const name = String(entry.name).trim();
    if (name) {
      fallback.name = name;
    }
  }

  if (entry.xver !== undefined && entry.xver !== null) {
    const xver = Number.parseInt(entry.xver, 10);
    if (!Number.isNaN(xver) && xver >= 0) {
      fallback.xver = xver;
    }
  }

  return fallback;
}

function parseFallbacks(rawFallbacks) {
  const source = parseJsonArray(rawFallbacks, []);
  return source.map(normalizeFallbackEntry).filter(Boolean);
}

function resolveTlsCertificatePaths() {
  const rawCertPath = String(process.env.SSL_CERT_PATH || '').trim();
  const rawKeyPath = String(process.env.SSL_KEY_PATH || '').trim();
  const certPath = rawCertPath
    ? /\.(pem|crt|cer)$/i.test(rawCertPath)
      ? rawCertPath
      : `${rawCertPath.replace(/\/+$/, '')}/fullchain.pem`
    : '/certs/fullchain.pem';

  return {
    certificateFile: certPath,
    keyFile: rawKeyPath || '/certs/key.pem'
  };
}

module.exports = {
  parseJsonArray,
  parseAlpn,
  parseFallbacks,
  resolveTlsCertificatePaths
};
