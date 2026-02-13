const { parseAlpn, parseFallbacks } = require('./shared');

function buildXhttpSettings(inbound) {
  const settings = {
    path: inbound.wsPath || '/'
  };

  if (inbound.wsHost) {
    const hosts = String(inbound.wsHost)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (hosts.length > 0) {
      settings.host = hosts;
    }
  }

  if (inbound.xhttpMode) {
    settings.mode = inbound.xhttpMode;
  }

  return settings;
}

function buildHttpUpgradeSettings(inbound) {
  const settings = {
    path: inbound.wsPath || '/'
  };

  if (inbound.wsHost) {
    settings.host = String(inbound.wsHost).trim();
  }

  return settings;
}

class TrojanProtocol {
  generateInbound(inbound) {
    const clients = inbound.userInbounds.map(ui => ({
      password: ui.user.password,
      email: ui.user.email,
      level: 0
    }));

    if (clients.length === 0) {
      return null;
    }

    const config = {
      listen: '0.0.0.0',
      port: inbound.port,
      protocol: 'trojan',
      tag: inbound.tag,
      settings: {
        clients,
        fallbacks: parseFallbacks(inbound.fallbacks)
      },
      streamSettings: {
        network: inbound.network.toLowerCase(),
        security: 'tls' // Trojan requires TLS
      }
    };

    // TLS is mandatory for Trojan
    config.streamSettings.tlsSettings = {
      serverName: inbound.serverName,
      certificates: [{
        certificateFile: process.env.SSL_CERT_FILE || '/certs/fullchain.pem',
        keyFile: process.env.SSL_KEY_FILE || '/certs/key.pem'
      }],
      alpn: parseAlpn(inbound.alpn)
    };

    // Network settings
    if (inbound.network === 'WS') {
      config.streamSettings.wsSettings = {
        path: inbound.wsPath || '/',
        headers: {
          Host: inbound.wsHost || ''
        }
      };
    } else if (inbound.network === 'GRPC') {
      config.streamSettings.grpcSettings = {
        serviceName: inbound.grpcServiceName || ''
      };
    } else if (inbound.network === 'HTTPUPGRADE') {
      config.streamSettings.httpupgradeSettings = buildHttpUpgradeSettings(inbound);
    } else if (inbound.network === 'XHTTP') {
      config.streamSettings.xhttpSettings = buildXhttpSettings(inbound);
    }

    return config;
  }
}

module.exports = new TrojanProtocol();
