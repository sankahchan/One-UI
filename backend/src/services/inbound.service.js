const { PrismaClient } = require('@prisma/client');
const crypto = require('node:crypto');
const JSZip = require('jszip');
const yaml = require('js-yaml');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errors');

const prisma = new PrismaClient();

const PROTOCOL_DEFAULTS = {
  SOCKS: { network: 'TCP', security: 'NONE' },
  HTTP: { network: 'TCP', security: 'NONE' },
  DOKODEMO_DOOR: { network: 'TCP', security: 'NONE' },
  MTPROTO: { network: 'TCP', security: 'NONE' },
  WIREGUARD: { network: 'TCP', security: 'NONE' },
  TROJAN: { security: 'TLS' }
};

const RANDOM_PORT_MIN_DEFAULT = 20000;
const RANDOM_PORT_MAX_DEFAULT = 60000;
const RANDOM_PORT_ATTEMPTS = 256;

const ALLOWED_FIELDS = new Set([
  'port',
  'protocol',
  'tag',
  'remark',
  'enabled',
  'network',
  'security',
  'serverName',
  'serverAddress',
  'alpn',
  'wsPath',
  'wsHost',
  'xhttpMode',
  'grpcServiceName',
  'cipher',
  'domains',
  'fallbacks',
  'realityPublicKey',
  'realityPrivateKey',
  'realityShortIds',
  'realityServerNames',
  'realityFingerprint',
  'realityDest',
  'realitySpiderX',
  'wgPrivateKey',
  'wgPublicKey',
  'wgAddress',
  'wgPeerPublicKey',
  'wgPeerEndpoint',
  'wgAllowedIPs',
  'wgMtu',
  'dokodemoTargetPort',
  'dokodemoNetwork',
  'dokodemoFollowRedirect'
]);

const TEMPLATE_PRESET_ALIASES = Object.freeze({
  full: 'full',
  all: 'full',
  auto: 'full',
  v2ray: 'v2ray',
  v2rayng: 'v2ray',
  v2rayn: 'v2ray',
  clash: 'clash',
  'clash-meta': 'clash',
  singbox: 'singbox',
  'sing-box': 'singbox',
  xray: 'xray',
  core: 'xray'
});

function normalizeStringArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim())
      .filter(Boolean);
  }

  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeJsonArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  return [];
}

function normalizeInboundPayload(input = {}) {
  const payload = { ...input };
  const protocol = payload.protocol;
  const security = String(payload.security || '').toUpperCase();

  if (payload.domains !== undefined) {
    payload.domains = normalizeStringArray(payload.domains);
  }

  if (payload.realityShortId && !payload.realityShortIds) {
    payload.realityShortIds = normalizeStringArray(payload.realityShortId);
  }

  if (payload.realityServerName && !payload.realityServerNames) {
    payload.realityServerNames = normalizeStringArray(payload.realityServerName);
  }

  if (payload.realityShortIds !== undefined) {
    payload.realityShortIds = normalizeStringArray(payload.realityShortIds);
  }

  if (payload.realityServerNames !== undefined) {
    payload.realityServerNames = normalizeStringArray(payload.realityServerNames);
  }

  if (payload.realityDest !== undefined) {
    const realityDest = String(payload.realityDest || '').trim();
    payload.realityDest = realityDest || undefined;
  }

  if (payload.realitySpiderX !== undefined) {
    const realitySpiderX = String(payload.realitySpiderX || '').trim();
    payload.realitySpiderX = realitySpiderX || undefined;
  }

  if (payload.alpn && Array.isArray(payload.alpn)) {
    payload.alpn = JSON.stringify(payload.alpn);
  }

  if (payload.alpn && typeof payload.alpn === 'string') {
    payload.alpn = payload.alpn.trim();
  }

  if (payload.fallbacks !== undefined) {
    payload.fallbacks = normalizeJsonArray(payload.fallbacks);
  }

  if (payload.wgMtu !== undefined) {
    const mtu = Number.parseInt(payload.wgMtu, 10);
    if (!Number.isNaN(mtu)) {
      payload.wgMtu = mtu;
    } else {
      delete payload.wgMtu;
    }
  }

  if (payload.dokodemoTargetPort !== undefined) {
    const targetPort = Number.parseInt(payload.dokodemoTargetPort, 10);
    if (!Number.isNaN(targetPort)) {
      payload.dokodemoTargetPort = targetPort;
    } else {
      delete payload.dokodemoTargetPort;
    }
  }

  if (payload.dokodemoFollowRedirect !== undefined) {
    payload.dokodemoFollowRedirect = Boolean(payload.dokodemoFollowRedirect);
  }

  if (protocol && PROTOCOL_DEFAULTS[protocol]) {
    Object.assign(payload, PROTOCOL_DEFAULTS[protocol]);
  }

  if (security === 'REALITY') {
    if (!payload.realityFingerprint) {
      payload.realityFingerprint = 'chrome';
    }

    if (!Array.isArray(payload.realityServerNames) || payload.realityServerNames.length === 0) {
      const fallbackServerName = String(payload.serverName || payload.serverAddress || '').trim();
      if (fallbackServerName) {
        payload.realityServerNames = [fallbackServerName];
      }
    }

    if (!payload.realityDest) {
      const fallbackDestHost = String(payload.serverName || payload.serverAddress || '').trim() || 'www.microsoft.com';
      payload.realityDest = `${fallbackDestHost}:443`;
    }
  }

  delete payload.realityShortId;
  delete payload.realityServerName;

  const normalized = {};

  for (const [key, value] of Object.entries(payload)) {
    if (!ALLOWED_FIELDS.has(key)) {
      continue;
    }

    if (value === undefined) {
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

function base64UrlToBase64(value = '') {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (normalized.length % 4)) % 4;
  return `${normalized}${'='.repeat(padding)}`;
}

function generateX25519KeyPairBase64() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');

  try {
    const privateJwk = privateKey.export({ format: 'jwk' });
    const publicJwk = publicKey.export({ format: 'jwk' });

    if (privateJwk?.d && publicJwk?.x) {
      return {
        privateKey: base64UrlToBase64(privateJwk.d),
        publicKey: base64UrlToBase64(publicJwk.x)
      };
    }
  } catch (_error) {
    // Fallback to DER parsing below.
  }

  const privateDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });

  return {
    privateKey: privateDer.subarray(-32).toString('base64'),
    publicKey: publicDer.subarray(-32).toString('base64')
  };
}

function generateRealityShortId(bytes = 8) {
  const size = Number.isInteger(bytes) && bytes > 0 && bytes <= 16 ? bytes : 8;
  return crypto.randomBytes(size).toString('hex');
}

function parseAlpn(alpn) {
  if (!alpn || typeof alpn !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(alpn);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((entry) => String(entry)).filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function safeBase64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function buildVlessUrl(inbound, user) {
  const params = new URLSearchParams();
  const network = String(inbound.network || 'TCP').toLowerCase();

  params.set('type', network);

  if (inbound.security === 'REALITY') {
    params.set('security', 'reality');
    params.set('sni', resolveServerName(inbound));
    params.set('fp', inbound.realityFingerprint || 'chrome');
    if (inbound.realityPublicKey) {
      params.set('pbk', inbound.realityPublicKey);
    }
    if (Array.isArray(inbound.realityShortIds) && inbound.realityShortIds.length > 0) {
      params.set('sid', inbound.realityShortIds[0]);
    }
    if (inbound.realitySpiderX) {
      params.set('spx', inbound.realitySpiderX);
    }
    params.set('flow', 'xtls-rprx-vision');
  } else {
    params.set('security', String(inbound.security || 'NONE').toLowerCase());
  }

  if (inbound.security === 'TLS') {
    params.set('sni', inbound.serverName || inbound.serverAddress || '');
    const alpnValues = parseAlpn(inbound.alpn);
    if (alpnValues.length > 0) {
      params.set('alpn', alpnValues.join(','));
    }
  }

  if (inbound.network === 'WS' || inbound.network === 'HTTPUPGRADE' || inbound.network === 'XHTTP') {
    params.set('path', inbound.wsPath || '/');
    if (inbound.wsHost) {
      params.set('host', inbound.wsHost);
    }
    if (inbound.network === 'XHTTP' && inbound.xhttpMode) {
      params.set('mode', inbound.xhttpMode);
    }
  } else if (inbound.network === 'GRPC') {
    params.set('serviceName', inbound.grpcServiceName || '');
    params.set('mode', 'gun');
  }

  const remark = encodeURIComponent(inbound.remark || inbound.tag || `${user.email}-vless`);
  return `vless://${user.uuid}@${inbound.serverAddress}:${inbound.port}?${params.toString()}#${remark}`;
}

function buildVmessUrl(inbound, user) {
  const config = {
    v: '2',
    ps: inbound.remark || inbound.tag || `${user.email}-vmess`,
    add: inbound.serverAddress,
    port: String(inbound.port),
    id: user.uuid,
    aid: '0',
    scy: 'auto',
    net: String(inbound.network || 'TCP').toLowerCase(),
    type: inbound.network === 'GRPC' ? 'gun' : 'none',
    host: inbound.wsHost || inbound.serverName || '',
    path: inbound.network === 'GRPC' ? inbound.grpcServiceName || '' : inbound.wsPath || '/',
    tls: inbound.security === 'TLS' ? 'tls' : '',
    sni: inbound.serverName || '',
    alpn: parseAlpn(inbound.alpn).join(',')
  };

  return `vmess://${safeBase64(JSON.stringify(config))}`;
}

function buildTrojanUrl(inbound, user) {
  const params = new URLSearchParams();
  params.set('type', String(inbound.network || 'TCP').toLowerCase());
  params.set('security', 'tls');
  params.set('sni', inbound.serverName || inbound.serverAddress || '');

  const alpnValues = parseAlpn(inbound.alpn);
  if (alpnValues.length > 0) {
    params.set('alpn', alpnValues.join(','));
  }

  if (inbound.network === 'WS' || inbound.network === 'HTTPUPGRADE' || inbound.network === 'XHTTP') {
    params.set('path', inbound.wsPath || '/');
    if (inbound.wsHost) {
      params.set('host', inbound.wsHost);
    }
    if (inbound.network === 'XHTTP' && inbound.xhttpMode) {
      params.set('mode', inbound.xhttpMode);
    }
  } else if (inbound.network === 'GRPC') {
    params.set('serviceName', inbound.grpcServiceName || '');
    params.set('mode', 'gun');
  }

  const remark = encodeURIComponent(inbound.remark || inbound.tag || `${user.email}-trojan`);
  return `trojan://${encodeURIComponent(user.password)}@${inbound.serverAddress}:${inbound.port}?${params.toString()}#${remark}`;
}

function buildShadowsocksUrl(inbound, user) {
  const cipher = inbound.cipher || 'chacha20-ietf-poly1305';
  const userInfo = safeBase64(`${cipher}:${user.password}`);
  const remark = encodeURIComponent(inbound.remark || inbound.tag || `${user.email}-ss`);
  return `ss://${userInfo}@${inbound.serverAddress}:${inbound.port}#${remark}`;
}

function buildMtprotoLink(inbound, user) {
  const secret = String(user.uuid || '')
    .replace(/-/g, '')
    .slice(0, 32);
  return `tg://proxy?server=${inbound.serverAddress}&port=${inbound.port}&secret=${secret}`;
}

function buildWireguardConfigTemplate(inbound, user) {
  const endpointPort = inbound.port || 51820;
  const endpoint = inbound.wgPeerEndpoint || `${inbound.serverAddress}:${endpointPort}`;

  return [
    '[Interface]',
    `# User: ${user.email}`,
    'PrivateKey = {WG_PRIVATE_KEY}',
    `Address = ${inbound.wgAddress || '10.66.2.2/32'}`,
    `MTU = ${inbound.wgMtu || 1420}`,
    '',
    '[Peer]',
    `PublicKey = ${inbound.wgPeerPublicKey || inbound.wgPublicKey || '{WG_PEER_PUBLIC_KEY}'}`,
    `Endpoint = ${endpoint}`,
    `AllowedIPs = ${inbound.wgAllowedIPs || '0.0.0.0/0, ::/0'}`,
    'PersistentKeepalive = 25'
  ].join('\n');
}

function buildSocksSnippet(inbound, user) {
  return JSON.stringify(
    {
      type: 'socks5',
      server: inbound.serverAddress,
      port: inbound.port,
      username: user.email,
      password: user.password
    },
    null,
    2
  );
}

function buildHttpSnippet(inbound, user) {
  return JSON.stringify(
    {
      type: 'http-proxy',
      host: inbound.serverAddress,
      port: inbound.port,
      username: user.email,
      password: user.password
    },
    null,
    2
  );
}

function buildDokodemoNote(inbound) {
  return [
    'Dokodemo-door forwarding profile',
    `Listen Port: ${inbound.port}`,
    `Target Address: ${inbound.serverAddress}`,
    `Target Port: ${inbound.dokodemoTargetPort || 80}`,
    `Target Network: ${inbound.dokodemoNetwork || 'tcp'}`,
    `Follow Redirect: ${Boolean(inbound.dokodemoFollowRedirect)}`
  ].join('\n');
}

function normalizeTemplatePreset(rawPreset) {
  if (rawPreset === undefined || rawPreset === null || rawPreset === '') {
    return 'full';
  }

  const key = String(rawPreset).trim().toLowerCase();
  return TEMPLATE_PRESET_ALIASES[key] || 'full';
}

function compactObject(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => compactObject(entry))
      .filter((entry) => entry !== undefined);
  }

  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      const compacted = compactObject(entry);
      if (compacted === undefined) {
        continue;
      }

      out[key] = compacted;
    }

    if (Object.keys(out).length === 0) {
      return undefined;
    }

    return out;
  }

  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return value;
}

function resolveServerName(inbound) {
  if (inbound.serverName) {
    return inbound.serverName;
  }

  if (Array.isArray(inbound.realityServerNames) && inbound.realityServerNames.length > 0) {
    return inbound.realityServerNames[0];
  }

  if (inbound.wsHost) {
    return inbound.wsHost;
  }

  return inbound.serverAddress || '';
}

function normalizeClashNetwork(network) {
  const normalized = String(network || 'TCP').toUpperCase();
  if (normalized === 'HTTPUPGRADE' || normalized === 'XHTTP') {
    return 'ws';
  }

  return normalized.toLowerCase();
}

function buildClashTransport(inbound) {
  const network = String(inbound.network || 'TCP').toUpperCase();
  const host = inbound.wsHost || resolveServerName(inbound);

  if (network === 'WS' || network === 'HTTPUPGRADE' || network === 'XHTTP') {
    return {
      'ws-opts': compactObject({
        path: inbound.wsPath || '/',
        headers: host ? { Host: host } : undefined
      })
    };
  }

  if (network === 'GRPC') {
    return {
      'grpc-opts': compactObject({
        'grpc-service-name': inbound.grpcServiceName || ''
      })
    };
  }

  if (network === 'HTTP') {
    return {
      'http-opts': compactObject({
        method: 'GET',
        path: [inbound.wsPath || '/'],
        headers: host ? { Host: [host] } : undefined
      })
    };
  }

  return {};
}

function buildClashTls(inbound) {
  if (inbound.security !== 'TLS' && inbound.security !== 'REALITY') {
    return {};
  }

  return compactObject({
    tls: true,
    servername: resolveServerName(inbound),
    'skip-cert-verify': false
  }) || {};
}

function buildClashReality(inbound) {
  if (inbound.security !== 'REALITY') {
    return {};
  }

  return compactObject({
    'client-fingerprint': inbound.realityFingerprint || 'chrome',
    'reality-opts': {
      'public-key': inbound.realityPublicKey,
      'short-id': Array.isArray(inbound.realityShortIds) ? inbound.realityShortIds[0] : undefined
    }
  }) || {};
}

function buildClashProxyObject(inbound, user, link) {
  const protocol = String(inbound.protocol || '').toUpperCase();
  const base = compactObject({
    name: inbound.remark || inbound.tag || `${protocol}-${inbound.port}`,
    server: inbound.serverAddress,
    port: inbound.port,
    network: normalizeClashNetwork(inbound.network),
    udp: true,
    'one-ui-template-link': link
  }) || {};

  const tls = buildClashTls(inbound);
  const reality = buildClashReality(inbound);
  const transport = buildClashTransport(inbound);

  switch (protocol) {
    case 'VLESS':
      return compactObject({
        ...base,
        type: 'vless',
        uuid: user.uuid,
        flow: inbound.security === 'REALITY' ? 'xtls-rprx-vision' : undefined,
        ...tls,
        ...reality,
        ...transport
      });
    case 'VMESS':
      return compactObject({
        ...base,
        type: 'vmess',
        uuid: user.uuid,
        alterId: 0,
        cipher: 'auto',
        ...tls,
        ...transport
      });
    case 'TROJAN':
      return compactObject({
        ...base,
        type: 'trojan',
        password: user.password,
        ...tls,
        ...transport
      });
    case 'SHADOWSOCKS':
      return compactObject({
        ...base,
        type: 'ss',
        cipher: inbound.cipher || 'chacha20-ietf-poly1305',
        password: user.password
      });
    case 'SOCKS':
      return compactObject({
        ...base,
        type: 'socks5',
        username: user.email,
        password: user.password
      });
    case 'HTTP':
      return compactObject({
        ...base,
        type: 'http',
        username: user.email,
        password: user.password
      });
    case 'WIREGUARD':
      return compactObject({
        ...base,
        type: 'wireguard',
        ip: inbound.wgAddress || '10.66.2.2/32',
        'private-key': '{WG_PRIVATE_KEY}',
        'public-key': inbound.wgPeerPublicKey || inbound.wgPublicKey || '{WG_PEER_PUBLIC_KEY}',
        mtu: inbound.wgMtu || 1420
      });
    default:
      return null;
  }
}

function buildSingboxTransport(inbound) {
  const network = String(inbound.network || 'TCP').toUpperCase();
  const host = inbound.wsHost || resolveServerName(inbound);

  if (network === 'WS') {
    return compactObject({
      type: 'ws',
      path: inbound.wsPath || '/',
      headers: host ? { Host: host } : undefined
    });
  }

  if (network === 'HTTPUPGRADE') {
    return compactObject({
      type: 'httpupgrade',
      path: inbound.wsPath || '/',
      host
    });
  }

  if (network === 'XHTTP') {
    return compactObject({
      type: 'http',
      path: inbound.wsPath || '/',
      host: host ? [host] : undefined,
      mode: inbound.xhttpMode
    });
  }

  if (network === 'GRPC') {
    return compactObject({
      type: 'grpc',
      service_name: inbound.grpcServiceName || ''
    });
  }

  if (network === 'HTTP') {
    return compactObject({
      type: 'http',
      host: host ? [host] : undefined,
      path: inbound.wsPath || '/'
    });
  }

  return undefined;
}

function buildSingboxTls(inbound) {
  if (inbound.security !== 'TLS' && inbound.security !== 'REALITY') {
    return undefined;
  }

  return compactObject({
    enabled: true,
    server_name: resolveServerName(inbound),
    insecure: false,
    alpn: parseAlpn(inbound.alpn),
    utls: inbound.security === 'REALITY' ? { enabled: true, fingerprint: inbound.realityFingerprint || 'chrome' } : undefined,
    reality: inbound.security === 'REALITY'
      ? {
          enabled: true,
          public_key: inbound.realityPublicKey,
          short_id: Array.isArray(inbound.realityShortIds) ? inbound.realityShortIds[0] : undefined
        }
      : undefined
  });
}

function buildSingboxOutboundObject(inbound, user, link) {
  const protocol = String(inbound.protocol || '').toUpperCase();
  const base = compactObject({
    tag: inbound.tag || protocol.toLowerCase(),
    server: inbound.serverAddress,
    server_port: inbound.port,
    'one_ui_template_link': link
  }) || {};

  const tls = buildSingboxTls(inbound);
  const transport = buildSingboxTransport(inbound);

  switch (protocol) {
    case 'VLESS':
      return compactObject({
        ...base,
        type: 'vless',
        uuid: user.uuid,
        flow: inbound.security === 'REALITY' ? 'xtls-rprx-vision' : undefined,
        tls,
        transport
      });
    case 'VMESS':
      return compactObject({
        ...base,
        type: 'vmess',
        uuid: user.uuid,
        security: 'auto',
        alter_id: 0,
        tls,
        transport
      });
    case 'TROJAN':
      return compactObject({
        ...base,
        type: 'trojan',
        password: user.password,
        tls,
        transport
      });
    case 'SHADOWSOCKS':
      return compactObject({
        ...base,
        type: 'shadowsocks',
        method: inbound.cipher || 'chacha20-ietf-poly1305',
        password: user.password
      });
    case 'SOCKS':
      return compactObject({
        ...base,
        type: 'socks',
        username: user.email,
        password: user.password
      });
    case 'HTTP':
      return compactObject({
        ...base,
        type: 'http',
        username: user.email,
        password: user.password
      });
    case 'WIREGUARD':
      return compactObject({
        ...base,
        type: 'wireguard',
        local_address: [inbound.wgAddress || '10.66.2.2/32'],
        private_key: '{WG_PRIVATE_KEY}',
        peer_public_key: inbound.wgPeerPublicKey || inbound.wgPublicKey || '{WG_PEER_PUBLIC_KEY}',
        reserved: [],
        mtu: inbound.wgMtu || 1420
      });
    default:
      return null;
  }
}

function buildXrayStreamSettings(inbound) {
  const network = String(inbound.network || 'TCP').toLowerCase();
  const stream = {
    network
  };

  if (inbound.security === 'TLS') {
    stream.security = 'tls';
    stream.tlsSettings = compactObject({
      serverName: resolveServerName(inbound),
      alpn: parseAlpn(inbound.alpn)
    });
  } else if (inbound.security === 'REALITY') {
    stream.security = 'reality';
    stream.realitySettings = compactObject({
      serverName: resolveServerName(inbound),
      dest: inbound.realityDest || `${resolveServerName(inbound) || 'www.microsoft.com'}:443`,
      fingerprint: inbound.realityFingerprint || 'chrome',
      publicKey: inbound.realityPublicKey,
      shortId: Array.isArray(inbound.realityShortIds) ? inbound.realityShortIds[0] : undefined,
      spiderX: inbound.realitySpiderX || undefined
    });
  } else {
    stream.security = 'none';
  }

  if (inbound.network === 'WS' || inbound.network === 'HTTPUPGRADE' || inbound.network === 'XHTTP') {
    stream.wsSettings = compactObject({
      path: inbound.wsPath || '/',
      headers: inbound.wsHost ? { Host: inbound.wsHost } : undefined
    });
  } else if (inbound.network === 'GRPC') {
    stream.grpcSettings = compactObject({
      serviceName: inbound.grpcServiceName || '',
      mode: 'gun'
    });
  } else if (inbound.network === 'HTTP') {
    stream.httpSettings = compactObject({
      path: inbound.wsPath ? [inbound.wsPath] : undefined,
      host: inbound.wsHost ? [inbound.wsHost] : undefined
    });
  }

  return compactObject(stream);
}

function buildXrayOutboundObject(inbound, user) {
  const protocol = String(inbound.protocol || '').toUpperCase();
  const streamSettings = buildXrayStreamSettings(inbound);
  const tag = `${inbound.tag || protocol.toLowerCase()}-one-ui`;

  switch (protocol) {
    case 'VLESS':
      return compactObject({
        tag,
        protocol: 'vless',
        settings: {
          vnext: [
            {
              address: inbound.serverAddress,
              port: inbound.port,
              users: [
                {
                  id: user.uuid,
                  encryption: 'none',
                  flow: inbound.security === 'REALITY' ? 'xtls-rprx-vision' : undefined,
                  level: 0
                }
              ]
            }
          ]
        },
        streamSettings
      });
    case 'VMESS':
      return compactObject({
        tag,
        protocol: 'vmess',
        settings: {
          vnext: [
            {
              address: inbound.serverAddress,
              port: inbound.port,
              users: [
                {
                  id: user.uuid,
                  alterId: 0,
                  security: 'auto',
                  level: 0
                }
              ]
            }
          ]
        },
        streamSettings
      });
    case 'TROJAN':
      return compactObject({
        tag,
        protocol: 'trojan',
        settings: {
          servers: [
            {
              address: inbound.serverAddress,
              port: inbound.port,
              password: user.password,
              level: 0
            }
          ]
        },
        streamSettings
      });
    case 'SHADOWSOCKS':
      return compactObject({
        tag,
        protocol: 'shadowsocks',
        settings: {
          servers: [
            {
              address: inbound.serverAddress,
              port: inbound.port,
              method: inbound.cipher || 'chacha20-ietf-poly1305',
              password: user.password,
              level: 0
            }
          ]
        }
      });
    case 'SOCKS':
      return compactObject({
        tag,
        protocol: 'socks',
        settings: {
          servers: [
            {
              address: inbound.serverAddress,
              port: inbound.port,
              users: [
                {
                  user: user.email,
                  pass: user.password
                }
              ]
            }
          ]
        }
      });
    case 'HTTP':
      return compactObject({
        tag,
        protocol: 'http',
        settings: {
          servers: [
            {
              address: inbound.serverAddress,
              port: inbound.port,
              users: [
                {
                  user: user.email,
                  pass: user.password
                }
              ]
            }
          ]
        }
      });
    case 'WIREGUARD': {
      const endpoint = inbound.wgPeerEndpoint || `${inbound.serverAddress}:${inbound.port || 51820}`;
      const [address, portString] = String(endpoint).split(':');
      return compactObject({
        tag,
        protocol: 'wireguard',
        settings: {
          secretKey: '{WG_PRIVATE_KEY}',
          address: [inbound.wgAddress || '10.66.2.2/32'],
          peers: [
            {
              publicKey: inbound.wgPeerPublicKey || inbound.wgPublicKey || '{WG_PEER_PUBLIC_KEY}',
              endpoint: portString ? `${address}:${portString}` : endpoint,
              allowedIPs: String(inbound.wgAllowedIPs || '0.0.0.0/0,::/0').split(',').map((item) => item.trim()).filter(Boolean)
            }
          ],
          mtu: inbound.wgMtu || 1420
        }
      });
    }
    default:
      return null;
  }
}

function buildClashSnippet(inbound, user, link) {
  const proxy = buildClashProxyObject(inbound, user, link);
  if (!proxy) {
    return 'No Clash-compatible template available for this protocol.';
  }

  return `${yaml.dump({ proxies: [proxy] }, { noRefs: true, lineWidth: -1 }).trim()}\n`;
}

function buildSingboxSnippet(inbound, user, link) {
  const outbound = buildSingboxOutboundObject(inbound, user, link);
  if (!outbound) {
    return JSON.stringify({ message: 'No Sing-box template available for this protocol.' }, null, 2);
  }

  return JSON.stringify({ outbounds: [outbound] }, null, 2);
}

function buildXrayOutboundSnippet(inbound, user) {
  const outbound = buildXrayOutboundObject(inbound, user);
  if (!outbound) {
    return JSON.stringify({ message: 'No Xray outbound snippet available for this protocol.' }, null, 2);
  }

  return JSON.stringify({ outbounds: [outbound] }, null, 2);
}

function getSubscriptionBaseUrl() {
  const explicit = process.env.SUBSCRIPTION_URL || process.env.PUBLIC_BASE_URL;
  if (explicit && String(explicit).trim()) {
    return String(explicit).trim().replace(/\/$/, '');
  }

  const port = process.env.PORT || '3000';
  return `http://127.0.0.1:${port}`;
}

function buildSubscriptionTemplates(user) {
  if (!user?.subscriptionToken) {
    return [];
  }

  const base = getSubscriptionBaseUrl();
  const subBase = `${base}/sub/${user.subscriptionToken}`;

  return [
    {
      id: 'subscription-v2ray',
      title: 'Subscription URL (V2Ray)',
      description: 'Direct subscription link for V2Ray clients',
      content: `${subBase}?target=v2ray`,
      extension: 'txt',
      mimeType: 'text/plain; charset=utf-8',
      qrValue: `${subBase}?target=v2ray`,
      targets: ['v2ray', 'generic']
    },
    {
      id: 'subscription-clash',
      title: 'Subscription URL (Clash)',
      description: 'Direct subscription link for Clash clients',
      content: `${subBase}?target=clash`,
      extension: 'txt',
      mimeType: 'text/plain; charset=utf-8',
      qrValue: `${subBase}?target=clash`,
      targets: ['clash']
    },
    {
      id: 'subscription-singbox',
      title: 'Subscription URL (Sing-box)',
      description: 'Direct subscription link for Sing-box clients',
      content: `${subBase}?target=singbox`,
      extension: 'txt',
      mimeType: 'text/plain; charset=utf-8',
      qrValue: `${subBase}?target=singbox`,
      targets: ['singbox']
    }
  ];
}

function buildInboundClientTemplates(inbound, user) {
  const templates = [];

  const add = (template) => {
    templates.push({
      ...template,
      targets: Array.isArray(template.targets) && template.targets.length > 0 ? template.targets : ['generic']
    });
  };

  const addUrlWithClientSnippets = (baseId, title, description, link) => {
    add({
      id: baseId,
      title,
      description,
      content: link,
      extension: 'txt',
      mimeType: 'text/plain; charset=utf-8',
      qrValue: link,
      targets: ['v2ray', 'generic']
    });

    add({
      id: `${baseId}-clash`,
      title: `${title} (Clash Snippet)`,
      description: 'Starter snippet for Clash-like clients',
      content: buildClashSnippet(inbound, user, link),
      extension: 'yaml',
      mimeType: 'text/yaml; charset=utf-8',
      targets: ['clash']
    });

    add({
      id: `${baseId}-singbox`,
      title: `${title} (Sing-box Snippet)`,
      description: 'Starter snippet for Sing-box clients',
      content: buildSingboxSnippet(inbound, user, link),
      extension: 'json',
      mimeType: 'application/json; charset=utf-8',
      targets: ['singbox']
    });

    add({
      id: `${baseId}-xray`,
      title: `${title} (Xray Outbound Snippet)`,
      description: 'Xray-core outbound JSON snippet',
      content: buildXrayOutboundSnippet(inbound, user),
      extension: 'json',
      mimeType: 'application/json; charset=utf-8',
      targets: ['xray']
    });
  };

  switch (inbound.protocol) {
    case 'VLESS': {
      const url = buildVlessUrl(inbound, user);
      addUrlWithClientSnippets('vless-link', 'VLESS Link', 'User-specific VLESS share link', url);
      break;
    }
    case 'VMESS': {
      const url = buildVmessUrl(inbound, user);
      addUrlWithClientSnippets('vmess-link', 'VMess Link', 'User-specific VMess share link', url);
      break;
    }
    case 'TROJAN': {
      const url = buildTrojanUrl(inbound, user);
      addUrlWithClientSnippets('trojan-link', 'Trojan Link', 'User-specific Trojan share link', url);
      break;
    }
    case 'SHADOWSOCKS': {
      const url = buildShadowsocksUrl(inbound, user);
      addUrlWithClientSnippets('shadowsocks-link', 'Shadowsocks Link', 'User-specific Shadowsocks share link', url);
      break;
    }
    case 'SOCKS': {
      add({
        id: 'socks-json',
        title: 'SOCKS5 Client JSON',
        description: 'SOCKS client profile with user credentials',
        content: buildSocksSnippet(inbound, user),
        extension: 'json',
        mimeType: 'application/json; charset=utf-8',
        targets: ['generic', 'v2ray']
      });
      add({
        id: 'socks-clash',
        title: 'SOCKS5 Clash Snippet',
        description: 'Clash proxy snippet for SOCKS5',
        content: buildClashSnippet(inbound, user),
        extension: 'yaml',
        mimeType: 'text/yaml; charset=utf-8',
        targets: ['clash']
      });
      add({
        id: 'socks-singbox',
        title: 'SOCKS5 Sing-box Snippet',
        description: 'Sing-box outbound snippet for SOCKS5',
        content: buildSingboxSnippet(inbound, user),
        extension: 'json',
        mimeType: 'application/json; charset=utf-8',
        targets: ['singbox']
      });
      add({
        id: 'socks-xray',
        title: 'SOCKS5 Xray Outbound Snippet',
        description: 'Xray-core outbound JSON snippet',
        content: buildXrayOutboundSnippet(inbound, user),
        extension: 'json',
        mimeType: 'application/json; charset=utf-8',
        targets: ['xray']
      });
      break;
    }
    case 'HTTP': {
      add({
        id: 'http-json',
        title: 'HTTP Proxy Client JSON',
        description: 'HTTP proxy profile with user credentials',
        content: buildHttpSnippet(inbound, user),
        extension: 'json',
        mimeType: 'application/json; charset=utf-8',
        targets: ['generic', 'v2ray']
      });
      add({
        id: 'http-clash',
        title: 'HTTP Proxy Clash Snippet',
        description: 'Clash proxy snippet for HTTP proxy',
        content: buildClashSnippet(inbound, user),
        extension: 'yaml',
        mimeType: 'text/yaml; charset=utf-8',
        targets: ['clash']
      });
      add({
        id: 'http-singbox',
        title: 'HTTP Proxy Sing-box Snippet',
        description: 'Sing-box outbound snippet for HTTP proxy',
        content: buildSingboxSnippet(inbound, user),
        extension: 'json',
        mimeType: 'application/json; charset=utf-8',
        targets: ['singbox']
      });
      add({
        id: 'http-xray',
        title: 'HTTP Proxy Xray Outbound Snippet',
        description: 'Xray-core outbound JSON snippet',
        content: buildXrayOutboundSnippet(inbound, user),
        extension: 'json',
        mimeType: 'application/json; charset=utf-8',
        targets: ['xray']
      });
      break;
    }
    case 'DOKODEMO_DOOR': {
      add({
        id: 'dokodemo-note',
        title: 'Dokodemo-door Notes',
        description: 'Operational forwarding details',
        content: buildDokodemoNote(inbound),
        extension: 'txt',
        mimeType: 'text/plain; charset=utf-8',
        targets: ['generic', 'xray']
      });
      break;
    }
    case 'WIREGUARD': {
      const config = buildWireguardConfigTemplate(inbound, user);
      add({
        id: 'wireguard-config',
        title: 'WireGuard Config Template',
        description: 'Peer details resolved; add user private key before import',
        content: config,
        extension: 'conf',
        mimeType: 'text/plain; charset=utf-8',
        qrValue: config,
        targets: ['generic', 'v2ray']
      });
      add({
        id: 'wireguard-clash',
        title: 'WireGuard Clash Snippet',
        description: 'Clash-compatible WireGuard proxy snippet',
        content: buildClashSnippet(inbound, user),
        extension: 'yaml',
        mimeType: 'text/yaml; charset=utf-8',
        targets: ['clash']
      });
      add({
        id: 'wireguard-singbox',
        title: 'WireGuard Sing-box Snippet',
        description: 'Sing-box outbound snippet for WireGuard',
        content: buildSingboxSnippet(inbound, user),
        extension: 'json',
        mimeType: 'application/json; charset=utf-8',
        targets: ['singbox']
      });
      add({
        id: 'wireguard-xray',
        title: 'WireGuard Xray Outbound Snippet',
        description: 'Xray-core outbound JSON snippet',
        content: buildXrayOutboundSnippet(inbound, user),
        extension: 'json',
        mimeType: 'application/json; charset=utf-8',
        targets: ['xray']
      });
      break;
    }
    case 'MTPROTO': {
      const link = buildMtprotoLink(inbound, user);
      add({
        id: 'mtproto-link',
        title: 'MTProto Link',
        description: 'Telegram MTProto proxy link',
        content: link,
        extension: 'txt',
        mimeType: 'text/plain; charset=utf-8',
        qrValue: link,
        targets: ['v2ray', 'generic']
      });
      break;
    }
    default:
      add({
        id: 'unsupported',
        title: 'Unsupported Protocol',
        description: 'No template generator exists for this protocol yet',
        content: 'No client template available.',
        extension: 'txt',
        mimeType: 'text/plain; charset=utf-8',
        targets: ['generic']
      });
  }

  for (const subscriptionTemplate of buildSubscriptionTemplates(user)) {
    add(subscriptionTemplate);
  }

  return templates;
}

function templateMatchesPreset(template, preset) {
  if (preset === 'full') {
    return true;
  }

  const targets = Array.isArray(template.targets) ? template.targets : ['generic'];
  if (preset === 'v2ray') {
    return targets.includes('v2ray') || targets.includes('generic');
  }

  return targets.includes(preset);
}

function filterTemplatesByPreset(templates, presetRaw) {
  const preset = normalizeTemplatePreset(presetRaw);
  const filtered = templates.filter((template) => templateMatchesPreset(template, preset));
  return {
    preset,
    templates: filtered.length > 0 ? filtered : templates
  };
}

function toSafeFilename(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

class InboundService {
  normalizePriority(value, fallback = 100) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed)) {
      return fallback;
    }
    return Math.max(1, Math.min(parsed, 9999));
  }

  async ensureUniqueTag(baseTag) {
    const base = String(baseTag || 'inbound').trim().replace(/\s+/g, '-').toLowerCase() || 'inbound';
    let candidate = base;
    let suffix = 1;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await prisma.inbound.findUnique({
        where: { tag: candidate },
        select: { id: true }
      });
      if (!exists) {
        return candidate;
      }

      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
  }

  parseMyanmarFallbackPorts(input) {
    if (Array.isArray(input)) {
      return input
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= 65535);
    }

    if (typeof input === 'string') {
      return input
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= 65535);
    }

    return [];
  }

  parseNumericIdList(input) {
    if (Array.isArray(input)) {
      return Array.from(
        new Set(
          input
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => Number.isInteger(value) && value > 0)
        )
      );
    }

    if (typeof input === 'string') {
      return Array.from(
        new Set(
          input
            .split(',')
            .map((value) => Number.parseInt(value.trim(), 10))
            .filter((value) => Number.isInteger(value) && value > 0)
        )
      );
    }

    return [];
  }

  async resolveAvailablePort(preferredPort, warnings) {
    const parsed = Number.parseInt(preferredPort, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      return this.getRandomAvailablePort();
    }

    const existing = await prisma.inbound.findUnique({
      where: { port: parsed },
      select: { id: true, tag: true }
    });

    if (!existing) {
      return parsed;
    }

    const fallback = await this.getRandomAvailablePort();
    warnings.push(`Port ${parsed} already in use by ${existing.tag}. Assigned ${fallback} instead.`);
    return fallback;
  }

  normalizeInboundIds(inboundIds) {
    if (!Array.isArray(inboundIds)) {
      throw new ValidationError('inboundIds must be an array');
    }

    const ids = [...new Set(inboundIds
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0))];

    if (ids.length === 0) {
      throw new ValidationError('At least one valid inbound id is required');
    }

    return ids;
  }

  async resolveInboundWithAssignedUsers(inboundId) {
    if (Number.isNaN(inboundId) || inboundId < 1) {
      throw new ValidationError('Inbound id must be a positive integer');
    }

    const inbound = await prisma.inbound.findUnique({
      where: { id: inboundId },
      include: {
        userInbounds: {
          where: { enabled: true },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                uuid: true,
                password: true,
                status: true,
                subscriptionToken: true
              }
            }
          }
        },
        groupInbounds: {
          where: {
            enabled: true,
            group: {
              isDisabled: false
            }
          },
          include: {
            group: {
              include: {
                users: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        email: true,
                        uuid: true,
                        password: true,
                        status: true,
                        subscriptionToken: true
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!inbound) {
      throw new NotFoundError('Inbound not found');
    }

    const userMap = new Map();

    for (const entry of inbound.userInbounds || []) {
      if (entry.user) {
        userMap.set(entry.user.id, entry.user);
      }
    }

    for (const entry of inbound.groupInbounds || []) {
      const groupUsers = entry.group?.users || [];
      for (const groupUser of groupUsers) {
        if (groupUser.user) {
          userMap.set(groupUser.user.id, groupUser.user);
        }
      }
    }

    const assignedUsers = Array.from(userMap.values());

    if (assignedUsers.length === 0) {
      throw new ValidationError('No users assigned to this inbound');
    }

    return { inbound, assignedUsers };
  }

  async generateWireguardKeyPair() {
    return generateX25519KeyPairBase64();
  }

  async generateRealityKeyBundle(options = {}) {
    const keyPair = generateX25519KeyPairBase64();
    const count = Number.parseInt(options.count, 10);
    const safeCount = Number.isInteger(count) && count > 0 ? Math.min(count, 5) : 1;

    const shortIds = Array.from({ length: safeCount }, () => generateRealityShortId(8));

    return {
      ...keyPair,
      shortIds,
      shortId: shortIds[0],
      fingerprint: 'chrome',
      serverName: options.serverName || 'www.microsoft.com'
    };
  }

  async rotateRealityInboundKeys(inboundId, options = {}) {
    const parsedInboundId = Number.parseInt(inboundId, 10);
    if (!Number.isInteger(parsedInboundId) || parsedInboundId < 1) {
      throw new ValidationError('Inbound id must be a positive integer');
    }

    const inbound = await prisma.inbound.findUnique({
      where: { id: parsedInboundId }
    });

    if (!inbound) {
      throw new NotFoundError('Inbound not found');
    }

    if (inbound.protocol !== 'VLESS' || inbound.security !== 'REALITY') {
      throw new ValidationError('Reality key rotation is only available for VLESS + REALITY inbounds');
    }

    const count = Number.parseInt(options.shortIdCount, 10);
    const bundle = await this.generateRealityKeyBundle({
      count: Number.isInteger(count) && count > 0 ? count : undefined,
      serverName: inbound.serverName || inbound.serverAddress || 'www.microsoft.com'
    });

    return prisma.inbound.update({
      where: { id: parsedInboundId },
      data: {
        realityPrivateKey: bundle.privateKey,
        realityPublicKey: bundle.publicKey,
        realityShortIds: bundle.shortIds,
        realityFingerprint: inbound.realityFingerprint || bundle.fingerprint || 'chrome'
      }
    });
  }

  async createMyanmarResiliencePack(payload = {}) {
    const dryRun = payload.dryRun === true || payload.dryRun === 'true';
    const serverAddress = String(payload.serverAddress || '').trim();
    const serverName = String(payload.serverName || serverAddress).trim();
    const cdnHost = String(payload.cdnHost || serverName).trim();
    const assignUserIds = this.parseNumericIdList(payload.userIds);
    const assignGroupIds = this.parseNumericIdList(payload.groupIds);

    if (!serverAddress) {
      throw new ValidationError('serverAddress is required');
    }

    if (!serverName) {
      throw new ValidationError('serverName is required');
    }

    const parsedFallbackPorts = this.parseMyanmarFallbackPorts(payload.fallbackPorts);
    const preferredWsPort = parsedFallbackPorts[0] || 8443;
    const preferredTrojanPort = parsedFallbackPorts[1] || 9443;
    const warnings = [];

    const [realityBundle, realityPort, wsPort, trojanPort] = await Promise.all([
      this.generateRealityKeyBundle({ serverName }),
      this.resolveAvailablePort(443, warnings),
      this.resolveAvailablePort(preferredWsPort, warnings),
      this.resolveAvailablePort(preferredTrojanPort, warnings)
    ]);

    const profiles = [
      {
        protocol: 'VLESS',
        network: 'XHTTP',
        security: 'REALITY',
        port: realityPort,
        tag: await this.ensureUniqueTag('mm-vless-reality-xhttp'),
        remark: 'Myanmar Pack - VLESS REALITY XHTTP',
        serverAddress,
        serverName,
        realityDest: `${serverName}:443`,
        realityPublicKey: realityBundle.publicKey,
        realityPrivateKey: realityBundle.privateKey,
        realityShortIds: [realityBundle.shortId],
        realityServerNames: [serverName],
        realityFingerprint: 'chrome',
        xhttpMode: 'auto',
        wsHost: cdnHost,
        wsPath: '/xhttp',
        enabled: true
      },
      {
        protocol: 'VLESS',
        network: 'WS',
        security: 'TLS',
        port: wsPort,
        tag: await this.ensureUniqueTag('mm-vless-ws-tls'),
        remark: 'Myanmar Pack - VLESS WS TLS',
        serverAddress,
        serverName,
        wsPath: '/ws',
        wsHost: cdnHost,
        alpn: JSON.stringify(['h2', 'http/1.1']),
        enabled: true
      },
      {
        protocol: 'TROJAN',
        network: 'WS',
        security: 'TLS',
        port: trojanPort,
        tag: await this.ensureUniqueTag('mm-trojan-ws-tls'),
        remark: 'Myanmar Pack - Trojan WS TLS',
        serverAddress,
        serverName,
        wsPath: '/trojan',
        wsHost: cdnHost,
        alpn: JSON.stringify(['h2', 'http/1.1']),
        enabled: true
      }
    ];

    if (dryRun) {
      return {
        dryRun: true,
        created: [],
        planned: profiles,
        warnings,
        assignment: {
          requestedUserIds: assignUserIds,
          requestedGroupIds: assignGroupIds,
          assignedUsers: 0,
          assignedGroups: 0
        }
      };
    }

    const created = [];
    for (const profile of profiles) {
      // eslint-disable-next-line no-await-in-loop
      const inbound = await this.createInbound(profile);
      created.push(inbound);
    }

    let assignedUsers = 0;
    let assignedGroups = 0;
    const createdInboundIds = created.map((entry) => entry.id);
    const relationPriorityStart = 100;
    const relationPriorityStep = 10;

    if (assignUserIds.length > 0) {
      const existingUsers = await prisma.user.findMany({
        where: { id: { in: assignUserIds } },
        select: { id: true }
      });
      const existingUserSet = new Set(existingUsers.map((entry) => entry.id));
      const missingUsers = assignUserIds.filter((id) => !existingUserSet.has(id));
      if (missingUsers.length > 0) {
        warnings.push(`Some user IDs were not found and skipped: ${missingUsers.join(', ')}`);
      }

      const userRelationData = [];
      for (const userId of existingUserSet) {
        createdInboundIds.forEach((createdInboundId, index) => {
          userRelationData.push({
            userId,
            inboundId: createdInboundId,
            enabled: true,
            priority: relationPriorityStart + (index * relationPriorityStep)
          });
        });
      }

      if (userRelationData.length > 0) {
        await prisma.userInbound.createMany({
          data: userRelationData,
          skipDuplicates: true
        });
      }

      assignedUsers = existingUserSet.size;
    }

    if (assignGroupIds.length > 0) {
      const existingGroups = await prisma.group.findMany({
        where: { id: { in: assignGroupIds } },
        select: { id: true }
      });
      const existingGroupSet = new Set(existingGroups.map((entry) => entry.id));
      const missingGroups = assignGroupIds.filter((id) => !existingGroupSet.has(id));
      if (missingGroups.length > 0) {
        warnings.push(`Some group IDs were not found and skipped: ${missingGroups.join(', ')}`);
      }

      const groupRelationData = [];
      for (const groupId of existingGroupSet) {
        createdInboundIds.forEach((createdInboundId, index) => {
          groupRelationData.push({
            groupId,
            inboundId: createdInboundId,
            enabled: true,
            priority: relationPriorityStart + (index * relationPriorityStep)
          });
        });
      }

      if (groupRelationData.length > 0) {
        await prisma.groupInbound.createMany({
          data: groupRelationData,
          skipDuplicates: true
        });
      }

      assignedGroups = existingGroupSet.size;
    }

    return {
      dryRun: false,
      created,
      planned: profiles,
      warnings,
      assignment: {
        requestedUserIds: assignUserIds,
        requestedGroupIds: assignGroupIds,
        assignedUsers,
        assignedGroups
      }
    };
  }

  resolveRandomPortRange(options = {}) {
    const envMin = Number.parseInt(process.env.INBOUND_RANDOM_PORT_MIN || '', 10);
    const envMax = Number.parseInt(process.env.INBOUND_RANDOM_PORT_MAX || '', 10);

    const min = Number.parseInt(options.min ?? envMin, 10);
    const max = Number.parseInt(options.max ?? envMax, 10);

    const safeMin = Number.isInteger(min) ? min : RANDOM_PORT_MIN_DEFAULT;
    const safeMax = Number.isInteger(max) ? max : RANDOM_PORT_MAX_DEFAULT;

    if (safeMin < 1 || safeMax > 65535 || safeMin >= safeMax) {
      throw new ValidationError('Invalid random port range');
    }

    return {
      min: safeMin,
      max: safeMax
    };
  }

  async getRandomAvailablePort(options = {}) {
    const { min, max } = this.resolveRandomPortRange(options);
    const excludePort = Number.parseInt(options.excludePort, 10);

    const rows = await prisma.inbound.findMany({
      select: { port: true }
    });

    const usedPorts = new Set(rows.map((row) => row.port));
    if (Number.isInteger(excludePort) && excludePort > 0) {
      usedPorts.delete(excludePort);
    }

    const rangeSize = max - min + 1;
    if (usedPorts.size >= rangeSize) {
      throw new ConflictError('No available random ports in configured range');
    }

    for (let index = 0; index < RANDOM_PORT_ATTEMPTS; index += 1) {
      const candidate = Math.floor(Math.random() * rangeSize) + min;
      if (!usedPorts.has(candidate)) {
        return candidate;
      }
    }

    const start = Math.floor(Math.random() * rangeSize) + min;
    for (let offset = 0; offset < rangeSize; offset += 1) {
      const candidate = min + ((start - min + offset) % rangeSize);
      if (!usedPorts.has(candidate)) {
        return candidate;
      }
    }

    throw new ConflictError('No available random ports in configured range');
  }

  async suggestRandomPort(options = {}) {
    const port = await this.getRandomAvailablePort(options);
    return { port };
  }

  async assignRandomPort(id, options = {}) {
    const inboundId = Number.parseInt(id, 10);
    if (Number.isNaN(inboundId) || inboundId < 1) {
      throw new ValidationError('Inbound id must be a positive integer');
    }

    const existing = await prisma.inbound.findUnique({
      where: { id: inboundId },
      select: { id: true, port: true }
    });

    if (!existing) {
      throw new NotFoundError('Inbound not found');
    }

    const port = await this.getRandomAvailablePort({
      ...options,
      excludePort: existing.port
    });

    const inbound = await prisma.inbound.update({
      where: { id: inboundId },
      data: { port }
    });

    return inbound;
  }

  async createInbound(data) {
    const normalizedData = normalizeInboundPayload(data);
    const { port, protocol, tag, remark, network, security, serverAddress, ...rest } = normalizedData;

    const existing = await prisma.inbound.findUnique({
      where: { port }
    });

    if (existing) {
      throw new ConflictError('Port already in use');
    }

    const existingTag = await prisma.inbound.findUnique({
      where: { tag }
    });

    if (existingTag) {
      throw new ConflictError('Tag already exists');
    }

    const inbound = await prisma.inbound.create({
      data: {
        port,
        protocol,
        tag,
        remark,
        network: network || 'TCP',
        security: security || 'NONE',
        serverAddress,
        ...rest
      }
    });

    return inbound;
  }

  async getInbounds() {
    const inbounds = await prisma.inbound.findMany({
      include: {
        _count: {
          select: {
            userInbounds: true
          }
        }
      },
      orderBy: { port: 'asc' }
    });

    return inbounds;
  }

  async listInbounds({ page = 1, limit = 50 } = {}) {
    const parsedPage = Number.parseInt(page, 10);
    const parsedLimit = Number.parseInt(limit, 10);

    const safePage = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
    const safeLimit = Number.isNaN(parsedLimit) || parsedLimit < 1 ? 50 : Math.min(parsedLimit, 100);

    const skip = (safePage - 1) * safeLimit;

    const [inbounds, total] = await Promise.all([
      prisma.inbound.findMany({
        skip,
        take: safeLimit,
        include: {
          _count: {
            select: {
              userInbounds: true
            }
          }
        },
        orderBy: { port: 'asc' }
      }),
      prisma.inbound.count()
    ]);

    return {
      inbounds,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit)
      }
    };
  }

  async getInboundById(id) {
    const inbound = await prisma.inbound.findUnique({
      where: { id: Number.parseInt(id, 10) },
      include: {
        userInbounds: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                status: true
              }
            }
          }
        }
      }
    });

    if (!inbound) {
      throw new NotFoundError('Inbound not found');
    }

    return inbound;
  }

  async getInboundClientTemplates(id, { userId, preset } = {}) {
    const inboundId = Number.parseInt(id, 10);
    const parsedUserId = userId !== undefined && userId !== null && userId !== ''
      ? Number.parseInt(userId, 10)
      : null;

    if (parsedUserId !== null && (Number.isNaN(parsedUserId) || parsedUserId < 1)) {
      throw new ValidationError('userId must be a positive integer');
    }

    const { inbound, assignedUsers } = await this.resolveInboundWithAssignedUsers(inboundId);

    let resolvedUser = null;

    if (parsedUserId !== null) {
      resolvedUser = assignedUsers.find((user) => user.id === parsedUserId) || null;
      if (!resolvedUser) {
        throw new ValidationError('Selected user is not assigned to this inbound');
      }
    } else {
      resolvedUser = assignedUsers.find((user) => user.status === 'ACTIVE') || assignedUsers[0];
    }

    const allTemplates = buildInboundClientTemplates(inbound, resolvedUser);
    const filtered = filterTemplatesByPreset(allTemplates, preset);

    return {
      inbound: {
        id: inbound.id,
        tag: inbound.tag,
        protocol: inbound.protocol,
        port: inbound.port,
        serverAddress: inbound.serverAddress,
        network: inbound.network,
        security: inbound.security
      },
      user: {
        id: resolvedUser.id,
        email: resolvedUser.email,
        status: resolvedUser.status
      },
      users: assignedUsers.map((user) => ({
        id: user.id,
        email: user.email,
        status: user.status
      })),
      preset: filtered.preset,
      templates: filtered.templates
    };
  }

  async getInboundClientTemplatePack(id, { userId, preset } = {}) {
    const payload = await this.getInboundClientTemplates(id, { userId, preset });
    const zip = new JSZip();

    const inboundLabel = toSafeFilename(payload.inbound.tag || payload.inbound.protocol || 'inbound');
    const userLabel = toSafeFilename(payload.user.email || `user-${payload.user.id}`);
    const root = `${inboundLabel}-${userLabel}`;

    const readme = [
      'One-UI Inbound Client Template Package',
      '',
      `Inbound: ${payload.inbound.tag} (${payload.inbound.protocol})`,
      `Server: ${payload.inbound.serverAddress}:${payload.inbound.port}`,
      `Network: ${payload.inbound.network}`,
      `Security: ${payload.inbound.security}`,
      `User: ${payload.user.email}`,
      `Preset: ${payload.preset || 'full'}`,
      '',
      'Generated by One-UI backend endpoint.',
      'Some protocols may require client-side adjustments after import.'
    ].join('\n');

    zip.file(`${root}/README.txt`, readme);

    payload.templates.forEach((template, index) => {
      const fileName = `${String(index + 1).padStart(2, '0')}-${toSafeFilename(template.id || template.title)}.${template.extension || 'txt'}`;
      zip.file(`${root}/${fileName}`, template.content || '');
    });

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    return {
      filename: `${root}.zip`,
      buffer,
      contentType: 'application/zip',
      size: buffer.length
    };
  }

  async getInboundAllUsersClientTemplatePack(id, { preset } = {}) {
    const inboundId = Number.parseInt(id, 10);
    const { inbound, assignedUsers } = await this.resolveInboundWithAssignedUsers(inboundId);
    const zip = new JSZip();

    const inboundLabel = toSafeFilename(inbound.tag || inbound.protocol || 'inbound');
    const root = `${inboundLabel}-all-users`;

    const rootReadme = [
      'One-UI Inbound Client Template Package (All Users)',
      '',
      `Inbound: ${inbound.tag} (${inbound.protocol})`,
      `Server: ${inbound.serverAddress}:${inbound.port}`,
      `Network: ${inbound.network}`,
      `Security: ${inbound.security}`,
      `Users: ${assignedUsers.length}`,
      `Preset: ${normalizeTemplatePreset(preset)}`,
      '',
      'Each user has its own folder with generated client templates.'
    ].join('\n');

    zip.file(`${root}/README.txt`, rootReadme);

    assignedUsers.forEach((user) => {
      const userFolder = `${root}/${toSafeFilename(user.email || `user-${user.id}`)}`;
      const templateSet = filterTemplatesByPreset(buildInboundClientTemplates(inbound, user), preset);
      const templates = templateSet.templates;

      const userReadme = [
        `User: ${user.email}`,
        `Status: ${user.status}`,
        `Inbound: ${inbound.tag}`,
        '',
        'Templates in this folder were generated for this user.'
      ].join('\n');
      zip.file(`${userFolder}/README.txt`, userReadme);

      templates.forEach((template, index) => {
        const fileName = `${String(index + 1).padStart(2, '0')}-${toSafeFilename(template.id || template.title)}.${template.extension || 'txt'}`;
        zip.file(`${userFolder}/${fileName}`, template.content || '');
      });
    });

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    return {
      filename: `${root}.zip`,
      buffer,
      contentType: 'application/zip',
      size: buffer.length
    };
  }

  async updateInbound(id, data) {
    const normalizedData = normalizeInboundPayload(data);

    const inbound = await prisma.inbound.update({
      where: { id: Number.parseInt(id, 10) },
      data: normalizedData
    });

    return inbound;
  }

  async deleteInbound(id) {
    await prisma.inbound.delete({
      where: { id: Number.parseInt(id, 10) }
    });

    return { id: Number.parseInt(id, 10) };
  }

  async bulkDeleteInbounds(inboundIds) {
    const ids = this.normalizeInboundIds(inboundIds);

    const existing = await prisma.inbound.findMany({
      where: { id: { in: ids } },
      select: { id: true }
    });
    const existingIds = existing.map((inbound) => inbound.id);
    const missingIds = ids.filter((id) => !existingIds.includes(id));

    const result = await prisma.inbound.deleteMany({
      where: { id: { in: ids } }
    });

    return {
      requestedCount: ids.length,
      deletedCount: result.count,
      missingIds
    };
  }

  async bulkSetEnabled(inboundIds, enabled) {
    const ids = this.normalizeInboundIds(inboundIds);
    const targetEnabled = Boolean(enabled);

    const existing = await prisma.inbound.findMany({
      where: { id: { in: ids } },
      select: { id: true, enabled: true }
    });

    const existingIds = existing.map((inbound) => inbound.id);
    const missingIds = ids.filter((id) => !existingIds.includes(id));

    const result = await prisma.inbound.updateMany({
      where: { id: { in: ids } },
      data: { enabled: targetEnabled }
    });

    return {
      requestedCount: ids.length,
      updatedCount: result.count,
      enabled: targetEnabled,
      missingIds
    };
  }

  async toggleInbound(id) {
    const inbound = await prisma.inbound.findUnique({
      where: { id: Number.parseInt(id, 10) }
    });

    if (!inbound) {
      throw new NotFoundError('Inbound not found');
    }

    const updated = await prisma.inbound.update({
      where: { id: Number.parseInt(id, 10) },
      data: { enabled: !inbound.enabled }
    });

    return updated;
  }
}

module.exports = new InboundService();
