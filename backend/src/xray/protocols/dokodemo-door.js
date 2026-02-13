class DokodemoDoorProtocol {
  generateInbound(inbound) {
    return {
      listen: '0.0.0.0',
      port: inbound.port,
      protocol: 'dokodemo-door',
      tag: inbound.tag,
      settings: {
        address: inbound.serverAddress || '127.0.0.1',
        port: inbound.dokodemoTargetPort || 80,
        network: inbound.dokodemoNetwork || 'tcp',
        followRedirect: Boolean(inbound.dokodemoFollowRedirect)
      },
      sniffing: {
        enabled: true,
        destOverride: ['http', 'tls']
      }
    };
  }
}

module.exports = new DokodemoDoorProtocol();
