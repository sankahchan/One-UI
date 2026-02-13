function normalizeCommaSeparated(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  const normalized = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(', ');

  return normalized || fallback;
}

function resolveAddress(inbound, index) {
  if (typeof inbound.wgAddress === 'string' && inbound.wgAddress.trim()) {
    return inbound.wgAddress.trim();
  }

  const hostOctet = (index % 250) + 2;
  return `10.66.${hostOctet}.2/32`;
}

class WireguardFormat {
  generate(_user, inbounds, options = {}) {
    const branding = options.branding || {};
    const wireguardInbounds = inbounds
      .filter((userInbound) => userInbound.enabled && userInbound.inbound?.enabled)
      .map((userInbound) => userInbound.inbound)
      .filter((inbound) => inbound.protocol === 'WIREGUARD');

    if (wireguardInbounds.length === 0) {
      throw new Error('No active WireGuard configurations found');
    }

    const profiles = wireguardInbounds
      .map((inbound, index) => this.buildConfig(inbound, index, branding))
      .filter(Boolean);

    if (profiles.length === 0) {
      throw new Error('WireGuard keys are missing for all active WireGuard inbounds');
    }

    return profiles.join('\n\n');
  }

  buildConfig(inbound, index, branding = {}) {
    const privateKey = typeof inbound.wgPrivateKey === 'string' ? inbound.wgPrivateKey.trim() : '';
    const peerPublicKey = typeof inbound.wgPeerPublicKey === 'string' && inbound.wgPeerPublicKey.trim()
      ? inbound.wgPeerPublicKey.trim()
      : (typeof inbound.wgPublicKey === 'string' ? inbound.wgPublicKey.trim() : '');

    const endpoint = typeof inbound.wgPeerEndpoint === 'string' && inbound.wgPeerEndpoint.trim()
      ? inbound.wgPeerEndpoint.trim()
      : `${inbound.serverAddress}:${inbound.port}`;

    if (!privateKey || !peerPublicKey || !endpoint) {
      return null;
    }

    const address = resolveAddress(inbound, index);
    const allowedIps = normalizeCommaSeparated(inbound.wgAllowedIPs, '0.0.0.0/0, ::/0');
    const dns = normalizeCommaSeparated(process.env.WIREGUARD_DNS, '1.1.1.1, 8.8.8.8');
    const mtu = Number.parseInt(inbound.wgMtu, 10);
    const profileName = inbound.remark || inbound.tag || `wireguard-${index + 1}`;

    const lines = [
      `# ${(branding.appName || 'One-UI')} WireGuard profile: ${profileName}`,
      '[Interface]',
      `PrivateKey = ${privateKey}`,
      `Address = ${address}`,
      `DNS = ${dns}`
    ];

    if (!Number.isNaN(mtu) && mtu > 0) {
      lines.push(`MTU = ${mtu}`);
    }

    lines.push(
      '',
      '[Peer]',
      `PublicKey = ${peerPublicKey}`,
      `Endpoint = ${endpoint}`,
      `AllowedIPs = ${allowedIps}`,
      'PersistentKeepalive = 25'
    );

    return lines.join('\n');
  }
}

module.exports = new WireguardFormat();
