class ShadowsocksProtocol {
  generateInbound(inbound) {
    // Shadowsocks uses single user mode per port
    if (inbound.userInbounds.length === 0) {
      return null;
    }

    // Use first user's password
    const user = inbound.userInbounds[0].user;

    const config = {
      listen: '0.0.0.0',
      port: inbound.port,
      protocol: 'shadowsocks',
      tag: inbound.tag,
      settings: {
        method: inbound.cipher || 'chacha20-ietf-poly1305',
        password: user.password,
        network: 'tcp,udp'
      }
    };

    return config;
  }
}

module.exports = new ShadowsocksProtocol();
