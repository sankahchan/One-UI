import type { Inbound } from '../types';

export interface InboundClientTemplate {
  id: string;
  title: string;
  description: string;
  content: string;
  extension: 'txt' | 'json' | 'yaml' | 'conf';
  mimeType: string;
  qrValue?: string;
  targets?: Array<'v2ray' | 'clash' | 'singbox' | 'xray' | 'generic'>;
}

export type TemplatePreset = 'full' | 'v2ray' | 'clash' | 'singbox' | 'xray';

const safeBase64 = (raw: string) => {
  try {
    return btoa(unescape(encodeURIComponent(raw)));
  } catch {
    return '';
  }
};

const parseAlpn = (alpn?: string) => {
  if (!alpn) {
    return [];
  }

  try {
    const parsed = JSON.parse(alpn);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
};

function buildVlessUrl(inbound: Inbound) {
  const params = new URLSearchParams();
  const network = inbound.network.toLowerCase();

  params.set('type', network);
  params.set('security', inbound.security.toLowerCase());

  if (inbound.security === 'TLS') {
    params.set('sni', inbound.serverName || inbound.serverAddress);
    const alpnValues = parseAlpn(inbound.alpn);
    if (alpnValues.length > 0) {
      params.set('alpn', alpnValues.join(','));
    }
  }

  if (inbound.security === 'REALITY') {
    params.set('security', 'reality');
    params.set('sni', inbound.serverName || inbound.serverAddress);
    params.set('fp', inbound.realityFingerprint || 'chrome');
    if (inbound.realityPublicKey) {
      params.set('pbk', inbound.realityPublicKey);
    }
    if (inbound.realityShortIds?.[0]) {
      params.set('sid', inbound.realityShortIds[0]);
    }
    params.set('flow', 'xtls-rprx-vision');
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

  const remark = encodeURIComponent(inbound.remark || inbound.tag || 'one-ui-vless');
  return `vless://{UUID}@${inbound.serverAddress}:${inbound.port}?${params.toString()}#${remark}`;
}

function buildVmessUrl(inbound: Inbound) {
  const config = {
    v: '2',
    ps: inbound.remark || inbound.tag || 'one-ui-vmess',
    add: inbound.serverAddress,
    port: String(inbound.port),
    id: '{UUID}',
    aid: '0',
    scy: 'auto',
    net: inbound.network.toLowerCase(),
    type: inbound.network === 'GRPC' ? 'gun' : 'none',
    host: inbound.wsHost || inbound.serverName || '',
    path: inbound.network === 'GRPC' ? inbound.grpcServiceName || '' : inbound.wsPath || '/',
    tls: inbound.security === 'TLS' ? 'tls' : '',
    sni: inbound.serverName || '',
    alpn: parseAlpn(inbound.alpn).join(',')
  };

  const payload = safeBase64(JSON.stringify(config));
  return `vmess://${payload}`;
}

function buildTrojanUrl(inbound: Inbound) {
  const params = new URLSearchParams();
  params.set('type', inbound.network.toLowerCase());
  params.set('security', 'tls');
  params.set('sni', inbound.serverName || inbound.serverAddress);

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

  const remark = encodeURIComponent(inbound.remark || inbound.tag || 'one-ui-trojan');
  return `trojan://{PASSWORD}@${inbound.serverAddress}:${inbound.port}?${params.toString()}#${remark}`;
}

function buildShadowsocksUrl(inbound: Inbound) {
  const method = inbound.cipher || 'chacha20-ietf-poly1305';
  const userInfo = safeBase64(`${method}:{PASSWORD}`);
  const remark = encodeURIComponent(inbound.remark || inbound.tag || 'one-ui-ss');
  return `ss://${userInfo}@${inbound.serverAddress}:${inbound.port}#${remark}`;
}

function buildWireguardConfig(inbound: Inbound) {
  const endpointPort = inbound.port || 51820;
  const endpoint = inbound.wgPeerEndpoint || `${inbound.serverAddress}:${endpointPort}`;
  const allowedIps = inbound.wgAllowedIPs || '0.0.0.0/0, ::/0';
  const mtu = inbound.wgMtu || 1420;

  return [
    '[Interface]',
    'PrivateKey = {WG_PRIVATE_KEY}',
    `Address = ${inbound.wgAddress || '10.66.2.2/32'}`,
    `MTU = ${mtu}`,
    '',
    '[Peer]',
    `PublicKey = ${inbound.wgPeerPublicKey || inbound.wgPublicKey || '{WG_PEER_PUBLIC_KEY}'}`,
    `Endpoint = ${endpoint}`,
    `AllowedIPs = ${allowedIps}`,
    'PersistentKeepalive = 25'
  ].join('\n');
}

function buildClashSnippet(inbound: Inbound, link: string) {
  return [
    'proxies:',
    `  - name: "${inbound.tag || inbound.protocol}"`,
    `    type: "${inbound.protocol.toLowerCase()}"`,
    `    server: "${inbound.serverAddress}"`,
    `    port: ${inbound.port}`,
    `    remark: "${inbound.remark || inbound.tag || ''}"`,
    `    one_ui_template_link: "${link.replace(/"/g, '\\"')}"`,
    '',
    '# Replace placeholders like {UUID}/{PASSWORD} before use.'
  ].join('\n');
}

function buildSingboxSnippet(inbound: Inbound, link: string) {
  return JSON.stringify(
    {
      type: inbound.protocol.toLowerCase(),
      tag: inbound.tag || inbound.protocol.toLowerCase(),
      server: inbound.serverAddress,
      server_port: inbound.port,
      one_ui_template_link: link,
      placeholders: ['{UUID}', '{PASSWORD}', '{WG_PRIVATE_KEY}']
    },
    null,
    2
  );
}

export function buildInboundClientTemplates(inbound: Inbound): InboundClientTemplate[] {
  const templates: InboundClientTemplate[] = [];

  const pushCommon = (id: string, title: string, description: string, content: string, qrValue?: string) => {
    templates.push({
      id,
      title,
      description,
      content,
      extension: 'txt',
      mimeType: 'text/plain; charset=utf-8',
      qrValue,
      targets: ['v2ray', 'generic']
    });

    templates.push({
      id: `${id}-clash`,
      title: `${title} (Clash Snippet)`,
      description: 'Starter snippet for Clash-like clients.',
      content: buildClashSnippet(inbound, content),
      extension: 'yaml',
      mimeType: 'text/yaml; charset=utf-8',
      targets: ['clash']
    });

    templates.push({
      id: `${id}-singbox`,
      title: `${title} (Sing-box Snippet)`,
      description: 'Starter snippet for Sing-box profiles.',
      content: buildSingboxSnippet(inbound, content),
      extension: 'json',
      mimeType: 'application/json; charset=utf-8',
      targets: ['singbox']
    });
  };

  switch (inbound.protocol) {
    case 'VLESS': {
      const url = buildVlessUrl(inbound);
      pushCommon('vless-link', 'VLESS Link Template', 'Replace {UUID} with the user UUID.', url, url);
      break;
    }
    case 'VMESS': {
      const url = buildVmessUrl(inbound);
      pushCommon('vmess-link', 'VMess Link Template', 'Replace {UUID} in the encoded payload before use.', url, url);
      break;
    }
    case 'TROJAN': {
      const url = buildTrojanUrl(inbound);
      pushCommon('trojan-link', 'Trojan Link Template', 'Replace {PASSWORD} with user password.', url, url);
      break;
    }
    case 'SHADOWSOCKS': {
      const url = buildShadowsocksUrl(inbound);
      pushCommon('shadowsocks-link', 'Shadowsocks Link Template', 'Replace {PASSWORD} with user password.', url, url);
      break;
    }
    case 'SOCKS': {
      const snippet = JSON.stringify(
        {
          type: 'socks5',
          server: inbound.serverAddress,
          port: inbound.port,
          username: '{EMAIL}',
          password: '{PASSWORD}'
        },
        null,
        2
      );
      templates.push({
        id: 'socks-snippet',
        title: 'SOCKS5 Client Snippet',
        description: 'Use panel user email/password for authentication.',
        content: snippet,
        extension: 'json',
        mimeType: 'application/json; charset=utf-8',
        targets: ['v2ray', 'generic']
      });
      break;
    }
    case 'HTTP': {
      const snippet = JSON.stringify(
        {
          type: 'http-proxy',
          host: inbound.serverAddress,
          port: inbound.port,
          username: '{EMAIL}',
          password: '{PASSWORD}'
        },
        null,
        2
      );
      templates.push({
        id: 'http-snippet',
        title: 'HTTP Proxy Client Snippet',
        description: 'Use panel user email/password for authentication.',
        content: snippet,
        extension: 'json',
        mimeType: 'application/json; charset=utf-8',
        targets: ['v2ray', 'generic']
      });
      break;
    }
    case 'DOKODEMO_DOOR': {
      const info = [
        'Dokodemo-door is forwarding/transparent mode.',
        'No direct end-user share link is generated.',
        '',
        `Listen: ${inbound.serverAddress}:${inbound.port}`,
        `Target: ${inbound.serverAddress}:${inbound.dokodemoTargetPort || 80}`,
        `Network: ${inbound.dokodemoNetwork || 'tcp'}`
      ].join('\n');
      templates.push({
        id: 'dokodemo-info',
        title: 'Dokodemo-door Notes',
        description: 'Operational notes for transparent routing setup.',
        content: info,
        extension: 'txt',
        mimeType: 'text/plain; charset=utf-8',
        targets: ['generic', 'xray']
      });
      break;
    }
    case 'WIREGUARD': {
      const config = buildWireguardConfig(inbound);
      templates.push({
        id: 'wireguard-config',
        title: 'WireGuard Config Template',
        description: 'Replace placeholders before importing into WireGuard client.',
        content: config,
        extension: 'conf',
        mimeType: 'text/plain; charset=utf-8',
        qrValue: config,
        targets: ['v2ray', 'generic']
      });
      break;
    }
    case 'MTPROTO': {
      const secret = '{MTPROTO_SECRET_HEX_32}';
      const url = `tg://proxy?server=${inbound.serverAddress}&port=${inbound.port}&secret=${secret}`;
      templates.push({
        id: 'mtproto-link',
        title: 'MTProto Link Template',
        description: 'Use Telegram proxy secret for client setup.',
        content: url,
        extension: 'txt',
        mimeType: 'text/plain; charset=utf-8',
        qrValue: url,
        targets: ['v2ray', 'generic']
      });
      break;
    }
    default:
      break;
  }

  if (templates.length === 0) {
    templates.push({
      id: 'generic-note',
      title: 'No Client Template',
      description: 'This protocol currently has no predefined client template in One-UI.',
      content: 'Create a custom client profile manually for this inbound.',
      extension: 'txt',
      mimeType: 'text/plain; charset=utf-8',
      targets: ['generic']
    });
  }

  return templates;
}

export function filterInboundTemplatesByPreset(
  templates: InboundClientTemplate[],
  preset: TemplatePreset
): InboundClientTemplate[] {
  if (preset === 'full') {
    return templates;
  }

  const filtered = templates.filter((template) => {
    const targets = template.targets || ['generic'];
    if (preset === 'v2ray') {
      return targets.includes('v2ray') || targets.includes('generic');
    }

    return targets.includes(preset);
  });

  return filtered.length > 0 ? filtered : templates;
}
