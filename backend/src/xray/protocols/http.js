class HttpProtocol {
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
      protocol: 'http',
      tag: inbound.tag,
      settings: {
        accounts,
        allowTransparent: false
      },
      sniffing: {
        enabled: true,
        destOverride: ['http', 'tls']
      }
    };
  }
}

module.exports = new HttpProtocol();
