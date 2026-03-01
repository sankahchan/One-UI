const { parseAlpn, resolveTlsCertificatePaths } = require('./shared');

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

class VMESSProtocol {
  generateInbound(inbound) {
    const clients = inbound.userInbounds.map(ui => ({
      id: ui.user.uuid,
      email: ui.user.email,
      alterId: 0,
      level: 0
    }));

    if (clients.length === 0) {
      return null;
    }

    const config = {
      listen: '0.0.0.0',
      port: inbound.port,
      protocol: 'vmess',
      tag: inbound.tag,
      settings: {
        clients
      },
      streamSettings: {
        network: inbound.network.toLowerCase(),
        security: inbound.security.toLowerCase()
      }
    };

    // TLS settings
    if (inbound.security === 'TLS') {
      const tlsCertificates = resolveTlsCertificatePaths();
      config.streamSettings.tlsSettings = {
        serverName: inbound.serverName,
        certificates: [{
          certificateFile: tlsCertificates.certificateFile,
          keyFile: tlsCertificates.keyFile
        }],
        alpn: parseAlpn(inbound.alpn)
      };
    }

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

module.exports = new VMESSProtocol();
