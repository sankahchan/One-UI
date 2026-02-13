class SocksProtocol {
  generateInbound(inbound) {
    const accounts = inbound.userInbounds
      .filter((ui) => ui.user?.email && ui.user?.password)
      .map((ui) => ({
        user: ui.user.email,
        pass: ui.user.password
      }));

    if (accounts.length === 0) {
      return null;
    }

    return {
      listen: '0.0.0.0',
      port: inbound.port,
      protocol: 'socks',
      tag: inbound.tag,
      settings: {
        auth: 'password',
        accounts,
        udp: true
      },
      sniffing: {
        enabled: true,
        destOverride: ['http', 'tls']
      }
    };
  }
}

module.exports = new SocksProtocol();
