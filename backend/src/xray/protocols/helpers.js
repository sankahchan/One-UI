function buildTlsSettings(inbound) {
  if (inbound.security !== 'TLS') {
    return {};
  }

  return {
    security: 'tls',
    tlsSettings: {
      serverName: inbound.serverName || inbound.serverAddress,
      alpn: parseAlpn(inbound.alpn)
    }
  };
}

function parseAlpn(rawAlpn) {
  if (!rawAlpn) {
    return undefined;
  }

  try {
    if (rawAlpn.trim().startsWith('[')) {
      const parsed = JSON.parse(rawAlpn);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }

    return rawAlpn
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  } catch (_error) {
    return rawAlpn
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
}

function buildNetworkSettings(inbound) {
  switch (inbound.network) {
    case 'WS':
      return {
        network: 'ws',
        wsSettings: {
          path: inbound.wsPath || '/',
          headers: inbound.wsHost
            ? {
                Host: inbound.wsHost
              }
            : undefined
        }
      };
    case 'GRPC':
      return {
        network: 'grpc',
        grpcSettings: {
          serviceName: inbound.grpcServiceName || 'grpc'
        }
      };
    case 'HTTP':
      return {
        network: 'http',
        httpSettings: {
          path: inbound.wsPath ? [inbound.wsPath] : ['/']
        }
      };
    case 'HTTPUPGRADE':
      return {
        network: 'httpupgrade',
        httpupgradeSettings: {
          path: inbound.wsPath || '/',
          host: inbound.wsHost || undefined
        }
      };
    case 'XHTTP':
      return {
        network: 'xhttp',
        xhttpSettings: {
          path: inbound.wsPath || '/',
          host: inbound.wsHost
            ? String(inbound.wsHost).split(',')[0].trim() || undefined
            : undefined,
          mode: inbound.xhttpMode || undefined
        }
      };
    case 'TCP':
    default:
      return {
        network: 'tcp'
      };
  }
}

function buildCommonInbound(inbound) {
  return {
    listen: '0.0.0.0',
    port: inbound.port,
    tag: inbound.tag,
    sniffing: {
      enabled: true,
      destOverride: ['http', 'tls']
    }
  };
}

module.exports = {
  buildTlsSettings,
  buildNetworkSettings,
  buildCommonInbound
};
