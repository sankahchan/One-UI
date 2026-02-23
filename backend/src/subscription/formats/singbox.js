const URLBuilder = require('./url-builder');

class SingboxFormat {
  buildHttpUpgradeTransport(inbound) {
    const transport = {
      type: 'httpupgrade',
      path: inbound.wsPath || '/'
    };

    if (inbound.wsHost) {
      const host = String(inbound.wsHost)
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (host.length > 0) {
        transport.host = host;
      }
    }

    return transport;
  }

  buildXhttpTransport(inbound) {
    const transport = {
      type: 'http',
      path: inbound.wsPath || '/'
    };

    if (inbound.wsHost) {
      const host = String(inbound.wsHost)
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (host.length > 0) {
        transport.host = host;
      }
    }

    if (inbound.xhttpMode) {
      transport.mode = inbound.xhttpMode;
    }

    return transport;
  }

  generate(user, inbounds) {
    const outbounds = [];
    const tags = [];

    for (const userInbound of inbounds) {
      const inbound = userInbound.inbound;

      if (!userInbound.enabled || !inbound.enabled) {
        continue;
      }

      const tag = `${inbound.protocol.toLowerCase()}-${inbound.port}`;
      const outbound = this.buildOutbound(user, inbound, tag);
      if (outbound) {
        tags.push(tag);
        outbounds.push(outbound);
      }
    }

    if (outbounds.length === 0) {
      throw new Error('No active proxies found');
    }

    outbounds.unshift(
      {
        type: 'selector',
        tag: 'proxy',
        outbounds: ['auto', ...tags],
        default: 'auto'
      },
      {
        type: 'urltest',
        tag: 'auto',
        outbounds: tags,
        url: 'https://www.gstatic.com/generate_204',
        interval: '5m',
        tolerance: 50
      }
    );

    outbounds.push(
      { type: 'direct', tag: 'direct' },
      { type: 'block', tag: 'block' },
      { type: 'dns', tag: 'dns-out' }
    );

    const config = {
      log: {
        disabled: false,
        level: 'info',
        timestamp: true
      },
      dns: {
        servers: [
          {
            tag: 'google',
            address: 'tls://8.8.8.8',
            detour: 'proxy'
          },
          {
            tag: 'local',
            address: '223.5.5.5',
            detour: 'direct'
          }
        ],
        rules: [
          {
            geosite: 'cn',
            server: 'local'
          }
        ],
        strategy: 'ipv4_only'
      },
      inbounds: [
        {
          type: 'mixed',
          tag: 'mixed-in',
          listen: '127.0.0.1',
          listen_port: 2080,
          sniff: true,
          sniff_override_destination: true
        }
      ],
      outbounds,
      route: {
        rules: [
          {
            protocol: 'dns',
            outbound: 'dns-out'
          },
          {
            geosite: ['category-ads-all'],
            outbound: 'block'
          },
          {
            geosite: 'cn',
            geoip: 'cn',
            outbound: 'direct'
          }
        ],
        auto_detect_interface: true,
        final: 'proxy'
      }
    };

    return JSON.stringify(config, null, 2);
  }

  buildOutbound(user, inbound, tag) {
    const base = {
      tag,
      server: inbound.serverAddress,
      server_port: inbound.port
    };

    switch (inbound.protocol) {
      case 'VLESS':
        const vlessOutbound = {
          type: 'vless',
          tag: tag,
          server: inbound.serverAddress,
          server_port: inbound.port,
          uuid: user.uuid,
          packet_encoding: 'xudp'
        };

        const vlessFlow = String(inbound.flow || '').trim();
        if (vlessFlow) {
          vlessOutbound.flow = vlessFlow;
        }

        if (inbound.security === 'TLS') {
          const parsedAlpn = URLBuilder.parseALPN(inbound.alpn);
          vlessOutbound.tls = {
            enabled: true,
            server_name: inbound.serverName || inbound.serverAddress,
            insecure: false,
            alpn: parsedAlpn.length > 0 ? parsedAlpn : ['h2', 'http/1.1']
          };
        } else if (inbound.security === 'REALITY') {
          vlessOutbound.flow = 'xtls-rprx-vision';
          vlessOutbound.tls = {
            enabled: true,
            server_name: inbound.serverName || inbound.serverAddress,
            utls: { enabled: true, fingerprint: inbound.realityFingerprint || 'chrome' },
            reality: {
              enabled: true,
              public_key: inbound.realityPublicKey,
              short_id: inbound.realityShortIds?.[0] || ''
            }
          };
        }

        if (inbound.network === 'WS') {
          vlessOutbound.transport = {
            type: 'ws',
            path: inbound.wsPath || '/',
            headers: inbound.wsHost ? { Host: inbound.wsHost } : {}
          };
        } else if (inbound.network === 'HTTPUPGRADE') {
          vlessOutbound.transport = this.buildHttpUpgradeTransport(inbound);
        } else if (inbound.network === 'XHTTP') {
          vlessOutbound.transport = this.buildXhttpTransport(inbound);
        } else if (inbound.network === 'GRPC') {
          vlessOutbound.transport = {
            type: 'grpc',
            service_name: inbound.grpcServiceName || ''
          };
        }

        return vlessOutbound;

      case 'VMESS':
        const vmessOutbound = {
          type: 'vmess',
          tag: tag,
          server: inbound.serverAddress,
          server_port: inbound.port,
          uuid: user.uuid,
          security: 'auto',
          alter_id: 0,
          global_padding: false,
          authenticated_length: true,
          packet_encoding: 'xudp'
        };

        if (inbound.security === 'TLS') {
          const parsedAlpn = URLBuilder.parseALPN(inbound.alpn);
          vmessOutbound.tls = {
            enabled: true,
            server_name: inbound.serverName || inbound.serverAddress,
            insecure: false,
            alpn: parsedAlpn.length > 0 ? parsedAlpn : ['h2', 'http/1.1']
          };
        }

        if (inbound.network === 'WS') {
          vmessOutbound.transport = {
            type: 'ws',
            path: inbound.wsPath || '/',
            headers: inbound.wsHost ? { Host: inbound.wsHost } : {}
          };
        } else if (inbound.network === 'HTTPUPGRADE') {
          vmessOutbound.transport = this.buildHttpUpgradeTransport(inbound);
        } else if (inbound.network === 'XHTTP') {
          vmessOutbound.transport = this.buildXhttpTransport(inbound);
        } else if (inbound.network === 'GRPC') {
          vmessOutbound.transport = {
            type: 'grpc',
            service_name: inbound.grpcServiceName || ''
          };
        }

        return vmessOutbound;

      case 'TROJAN':
        const trojanOutbound = {
          type: 'trojan',
          tag: tag,
          server: inbound.serverAddress,
          server_port: inbound.port,
          password: user.password,
          tls: {
            enabled: true,
            server_name: inbound.serverName || inbound.serverAddress,
            insecure: false
          }
        };

        if (inbound.network === 'WS') {
          trojanOutbound.transport = {
            type: 'ws',
            path: inbound.wsPath || '/',
            headers: inbound.wsHost ? { Host: inbound.wsHost } : {}
          };
        } else if (inbound.network === 'HTTPUPGRADE') {
          trojanOutbound.transport = this.buildHttpUpgradeTransport(inbound);
        } else if (inbound.network === 'XHTTP') {
          trojanOutbound.transport = this.buildXhttpTransport(inbound);
        } else if (inbound.network === 'GRPC') {
          trojanOutbound.transport = {
            type: 'grpc',
            service_name: inbound.grpcServiceName || ''
          };
        }

        return trojanOutbound;
      case 'SHADOWSOCKS':
        return {
          ...base,
          type: 'shadowsocks',
          method: inbound.cipher || 'chacha20-ietf-poly1305',
          password: user.password
        };
      case 'SOCKS':
        return {
          ...base,
          type: 'socks',
          username: user.email,
          password: user.password
        };
      case 'HTTP':
        return {
          ...base,
          type: 'http',
          username: user.email,
          password: user.password,
          tls: {
            enabled: inbound.security === 'TLS',
            server_name: inbound.serverName || inbound.serverAddress,
            insecure: false
          }
        };
      default:
        return null;
    }
  }

  buildTransport(inbound) {
    if (inbound.network === 'WS') {
      return {
        type: 'ws',
        path: inbound.wsPath || '/',
        headers: {
          Host: inbound.wsHost || inbound.serverName
        }
      };
    }

    if (inbound.network === 'GRPC') {
      return {
        type: 'grpc',
        service_name: inbound.grpcServiceName || ''
      };
    }

    if (inbound.network === 'XHTTP') {
      return this.buildXhttpTransport(inbound);
    }

    if (inbound.network === 'HTTPUPGRADE') {
      return this.buildHttpUpgradeTransport(inbound);
    }

    return undefined;
  }
}

module.exports = new SingboxFormat();
