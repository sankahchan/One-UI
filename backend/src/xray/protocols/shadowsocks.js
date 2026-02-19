const SS2022_CIPHERS = new Set([
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305'
]);

class ShadowsocksProtocol {
  generateInbound(inbound) {
    if (inbound.userInbounds.length === 0) {
      return null;
    }

    const method = inbound.cipher || 'chacha20-ietf-poly1305';
    const isSS2022 = SS2022_CIPHERS.has(method);

    // Build clients array — matches how 3X-UI structures SS inbounds.
    // For legacy ciphers each client carries its own method; for SS2022
    // the method is only at the inbound level.
    const clients = inbound.userInbounds
      .filter((ui) => ui.user?.password)
      .map((ui) => {
        const client = {
          password: ui.user.password,
          email: ui.user.email || ''
        };
        if (!isSS2022) {
          client.method = method;
          client.level = 0;
        }
        return client;
      });

    if (clients.length === 0) {
      return null;
    }

    const settings = {
      method,
      clients,
      network: 'tcp,udp'
    };

    // For SS2022 the inbound needs a server-level password (PSK).
    // Use the first user's password as the server key when no
    // dedicated server password exists on the inbound model.
    if (isSS2022) {
      settings.password = inbound.userInbounds[0].user.password;
    }

    return {
      listen: '0.0.0.0',
      port: inbound.port,
      protocol: 'shadowsocks',
      tag: inbound.tag,
      settings,
      sniffing: {
        enabled: true,
        destOverride: ['http', 'tls']
      }
    };
  }
}

module.exports = new ShadowsocksProtocol();
module.exports.SS2022_CIPHERS = SS2022_CIPHERS;
