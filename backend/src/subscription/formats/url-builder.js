class URLBuilder {
  static parseALPN(rawAlpn) {
    if (!rawAlpn) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawAlpn);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  // VLESS URL: vless://uuid@host:port?params#remark
  static buildVLESSURL(user, inbound) {
    const params = new URLSearchParams();
    const security = (inbound.security || 'NONE').toUpperCase();

    params.append('type', inbound.network.toLowerCase());
    params.append('security', security.toLowerCase());

    if (security === 'TLS') {
      params.append('sni', inbound.serverName || '');
      if (inbound.alpn) {
        const alpn = URLBuilder.parseALPN(inbound.alpn).join(',');
        if (alpn) {
          params.append('alpn', alpn);
        }
      }
    }

    if (security === 'REALITY') {
      const realityServerName = Array.isArray(inbound.realityServerNames) && inbound.realityServerNames.length > 0
        ? inbound.realityServerNames[0]
        : (inbound.serverName || '');
      params.append('sni', realityServerName);
      params.append('fp', inbound.realityFingerprint || 'chrome');
      if (inbound.realityPublicKey) {
        params.append('pbk', inbound.realityPublicKey);
      }
      const shortId = Array.isArray(inbound.realityShortIds) && inbound.realityShortIds.length > 0
        ? inbound.realityShortIds[0]
        : (inbound.realityShortId || '');
      if (shortId) {
        params.append('sid', shortId);
      }
      if (inbound.realitySpiderX) {
        params.append('spx', inbound.realitySpiderX);
      }
      params.append('flow', 'xtls-rprx-vision');
    }

    if (inbound.network === 'WS') {
      params.append('path', inbound.wsPath || '/');
      params.append('host', inbound.wsHost || inbound.serverName || '');
    } else if (inbound.network === 'HTTPUPGRADE') {
      params.append('path', inbound.wsPath || '/');
      params.append('host', inbound.wsHost || inbound.serverName || '');
    } else if (inbound.network === 'XHTTP') {
      params.append('path', inbound.wsPath || '/');
      params.append('host', inbound.wsHost || inbound.serverName || '');
      if (inbound.xhttpMode) {
        params.append('mode', inbound.xhttpMode);
      }
    } else if (inbound.network === 'GRPC') {
      params.append('serviceName', inbound.grpcServiceName || '');
      params.append('mode', 'gun');
    }

    const flowValue = String(inbound.flow || '').trim();
    if (flowValue && security !== 'REALITY') {
      params.append('flow', flowValue);
    }

    const remark = encodeURIComponent(inbound.remark || `${user.email}-VLESS`);
    return `vless://${user.uuid}@${inbound.serverAddress}:${inbound.port}?${params.toString()}#${remark}`;
  }

  // VMess URL: vmess://base64(json)
  static buildVMESSURL(user, inbound) {
    const config = {
      v: '2',
      ps: inbound.remark || `${user.email}-VMess`,
      add: inbound.serverAddress,
      port: inbound.port.toString(),
      id: user.uuid,
      aid: '0',
      scy: 'auto',
      net: inbound.network.toLowerCase(),
      type: 'none',
      host: inbound.wsHost || inbound.serverName || '',
      path: inbound.wsPath || '/',
      tls: inbound.security === 'TLS' ? 'tls' : '',
      sni: inbound.serverName || '',
      alpn: inbound.alpn ? URLBuilder.parseALPN(inbound.alpn).join(',') : ''
    };

    if (inbound.network === 'GRPC') {
      config.path = inbound.grpcServiceName || '';
      config.type = 'gun';
    } else if (inbound.network === 'HTTPUPGRADE') {
      config.path = inbound.wsPath || '/';
      config.type = 'httpupgrade';
    } else if (inbound.network === 'XHTTP') {
      config.path = inbound.wsPath || '/';
      config.type = inbound.xhttpMode || 'auto';
    }

    const jsonStr = JSON.stringify(config);
    const base64 = Buffer.from(jsonStr).toString('base64');
    return `vmess://${base64}`;
  }

  // Trojan URL: trojan://password@host:port?params#remark
  static buildTrojanURL(user, inbound) {
    const params = new URLSearchParams();

    params.append('type', inbound.network.toLowerCase());
    params.append('security', 'tls');
    params.append('sni', inbound.serverName || '');

    if (inbound.alpn) {
      const alpn = URLBuilder.parseALPN(inbound.alpn).join(',');
      if (alpn) {
        params.append('alpn', alpn);
      }
    }

    if (inbound.network === 'WS') {
      params.append('path', inbound.wsPath || '/');
      params.append('host', inbound.wsHost || inbound.serverName || '');
    } else if (inbound.network === 'HTTPUPGRADE') {
      params.append('path', inbound.wsPath || '/');
      params.append('host', inbound.wsHost || inbound.serverName || '');
    } else if (inbound.network === 'XHTTP') {
      params.append('path', inbound.wsPath || '/');
      params.append('host', inbound.wsHost || inbound.serverName || '');
      if (inbound.xhttpMode) {
        params.append('mode', inbound.xhttpMode);
      }
    } else if (inbound.network === 'GRPC') {
      params.append('serviceName', inbound.grpcServiceName || '');
      params.append('mode', 'gun');
    }

    const remark = encodeURIComponent(inbound.remark || `${user.email}-Trojan`);
    return `trojan://${encodeURIComponent(user.password)}@${inbound.serverAddress}:${inbound.port}?${params.toString()}#${remark}`;
  }

  // Shadowsocks URL (SIP002): ss://base64(method:password)@host:port#remark
  static buildShadowsocksURL(user, inbound) {
    const cipher = inbound.cipher || 'chacha20-ietf-poly1305';
    // SIP002 format: only method:password is base64url-encoded; host:port stays outside.
    // This is the standard format expected by modern clients (Hiddify, Shadowrocket, Clash, etc.).
    const userinfo = Buffer.from(`${cipher}:${user.password}`).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const remark = encodeURIComponent(inbound.remark || `${user.email}-SS`);

    return `ss://${userinfo}@${inbound.serverAddress}:${inbound.port}#${remark}`;
  }

  // SOCKS URL: socks://user:pass@host:port#remark
  static buildSocksURL(user, inbound) {
    const username = encodeURIComponent(user.email);
    const password = encodeURIComponent(user.password);
    const remark = encodeURIComponent(inbound.remark || `${user.email}-SOCKS`);
    return `socks://${username}:${password}@${inbound.serverAddress}:${inbound.port}#${remark}`;
  }

  // HTTP proxy URL: http://user:pass@host:port#remark
  static buildHttpURL(user, inbound) {
    const username = encodeURIComponent(user.email);
    const password = encodeURIComponent(user.password);
    const remark = encodeURIComponent(inbound.remark || `${user.email}-HTTP`);
    return `http://${username}:${password}@${inbound.serverAddress}:${inbound.port}#${remark}`;
  }

  // MTProto URL: tg://proxy?server=SERVER&port=PORT&secret=SECRET
  static buildMtprotoURL(user, inbound) {
    const secret = String(user.uuid || '').replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(secret)) {
      return null;
    }

    const params = new URLSearchParams({
      server: inbound.serverAddress,
      port: String(inbound.port),
      secret
    });

    return `tg://proxy?${params.toString()}`;
  }

  static buildProtocolURL(protocol, user, inbound) {
    switch (protocol) {
      case 'VLESS':
        return URLBuilder.buildVLESSURL(user, inbound);
      case 'VMESS':
        return URLBuilder.buildVMESSURL(user, inbound);
      case 'TROJAN':
        return URLBuilder.buildTrojanURL(user, inbound);
      case 'SHADOWSOCKS':
        return URLBuilder.buildShadowsocksURL(user, inbound);
      case 'SOCKS':
        return URLBuilder.buildSocksURL(user, inbound);
      case 'HTTP':
        return URLBuilder.buildHttpURL(user, inbound);
      case 'MTPROTO':
        return URLBuilder.buildMtprotoURL(user, inbound);
      default:
        return null;
    }
  }
}

module.exports = URLBuilder;

// Compatibility exports for existing imports
module.exports.parseAlpn = (rawAlpn) => URLBuilder.parseALPN(rawAlpn);
module.exports.buildProtocolUrl = (protocol, user, inbound) => URLBuilder.buildProtocolURL(protocol, user, inbound);
