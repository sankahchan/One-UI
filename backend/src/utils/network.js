const net = require('node:net');

function normalizeClientIp(ip) {
  if (!ip) {
    return '';
  }

  let normalized = String(ip).trim();
  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice(7);
  }
  if (normalized === '::1') {
    return '127.0.0.1';
  }

  return normalized;
}

function ipv4ToInt(ip) {
  const octets = ip.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return null;
  }

  return ((octets[0] << 24) >>> 0) + ((octets[1] << 16) >>> 0) + ((octets[2] << 8) >>> 0) + octets[3];
}

function isIpv4InCidr(ip, cidr) {
  const [network, maskLengthRaw] = cidr.split('/');
  const maskLength = Number.parseInt(maskLengthRaw, 10);
  if (!network || Number.isNaN(maskLength) || maskLength < 0 || maskLength > 32) {
    return false;
  }

  const ipInt = ipv4ToInt(ip);
  const networkInt = ipv4ToInt(network);
  if (ipInt === null || networkInt === null) {
    return false;
  }

  if (maskLength === 0) {
    return true;
  }

  const mask = (0xffffffff << (32 - maskLength)) >>> 0;
  return (ipInt & mask) === (networkInt & mask);
}

function parseAllowlist(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isIpAllowed(ip, allowlist = []) {
  const normalizedIp = normalizeClientIp(ip);
  if (!normalizedIp || allowlist.length === 0) {
    return true;
  }

  for (const entryRaw of allowlist) {
    const entry = String(entryRaw).trim();
    if (!entry) {
      continue;
    }

    if (entry === '*' || entry === normalizedIp) {
      return true;
    }

    if (entry.includes('/') && net.isIPv4(normalizedIp)) {
      if (isIpv4InCidr(normalizedIp, entry)) {
        return true;
      }
    }
  }

  return false;
}

function isPrivateIp(ip) {
  const normalizedIp = normalizeClientIp(ip);
  if (!normalizedIp) {
    return false;
  }

  if (net.isIPv4(normalizedIp)) {
    return (
      isIpv4InCidr(normalizedIp, '10.0.0.0/8')
      || isIpv4InCidr(normalizedIp, '172.16.0.0/12')
      || isIpv4InCidr(normalizedIp, '192.168.0.0/16')
      || isIpv4InCidr(normalizedIp, '127.0.0.0/8')
      || isIpv4InCidr(normalizedIp, '169.254.0.0/16')
    );
  }

  if (normalizedIp === '::1') {
    return true;
  }

  if (net.isIPv6(normalizedIp)) {
    const lower = normalizedIp.toLowerCase();
    return (
      lower.startsWith('fc')
      || lower.startsWith('fd')
      || lower.startsWith('fe8')
      || lower.startsWith('fe9')
      || lower.startsWith('fea')
      || lower.startsWith('feb')
    );
  }

  return false;
}

module.exports = {
  normalizeClientIp,
  isIpv4InCidr,
  parseAllowlist,
  isIpAllowed,
  isPrivateIp
};
