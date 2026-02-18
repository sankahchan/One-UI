const SS2022_CIPHERS = new Set([
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305'
]);

class ShadowsocksProtocol {
  generateInbound(inbound) {
    // Shadowsocks uses single user mode per port
    if (inbound.userInbounds.length === 0) {
      return null;
    }

    // Use first user's password
    const user = inbound.userInbounds[0].user;
    const method = inbound.cipher || 'chacha20-ietf-poly1305';

    const config = {
      listen: '0.0.0.0',
      port: inbound.port,
      protocol: 'shadowsocks',
      tag: inbound.tag,
      settings: {
        method,
        password: user.password,
        network: 'tcp,udp',
        level: 0,
        email: user.email
      },
      sniffing: {
        enabled: true,
        destOverride: ['http', 'tls']
      }
    };

    // SS2022 multi-user mode: use clients array so each user gets their own
    // sub-key and the server password becomes the master key
    if (SS2022_CIPHERS.has(method) && inbound.userInbounds.length > 1) {
      const clients = inbound.userInbounds
        .filter((ui) => ui.user?.password)
        .map((ui) => ({
          password: ui.user.password,
          email: ui.user.email || ''
        }));

      if (clients.length > 0) {
        // For SS2022 multi-user, the top-level password is the server key
        // and each client has their own sub-key
        config.settings.clients = clients;
        // Remove top-level email since clients each have their own
        delete config.settings.email;
      }
    }

    return config;
  }
}

module.exports = new ShadowsocksProtocol();
