class ClientDetector {
  detect(userAgent) {
    if (!userAgent) {
      return 'v2ray';
    }

    const ua = userAgent.toLowerCase();

    if (ua.includes('clash')) {
      return 'clash';
    }
    if (ua.includes('stash')) {
      return 'clash';
    }
    if (ua.includes('clashx')) {
      return 'clash';
    }

    if (ua.includes('sing-box')) {
      return 'singbox';
    }
    if (ua.includes('sfa')) {
      return 'singbox';
    }
    if (ua.includes('sfi')) {
      return 'singbox';
    }
    if (ua.includes('hiddify')) {
      return 'singbox';
    }
    if (ua.includes('hiddifynext')) {
      return 'singbox';
    }

    if (ua.includes('v2ray')) {
      return 'v2ray';
    }
    if (ua.includes('v2rayn')) {
      return 'v2ray';
    }
    if (ua.includes('v2rayng')) {
      return 'v2ray';
    }
    if (ua.includes('shadowrocket')) {
      return 'v2ray';
    }
    if (ua.includes('wireguard')) {
      return 'wireguard';
    }
    if (ua.includes('mieru')) {
      return 'mieru';
    }

    return 'v2ray';
  }

  getContentType(format) {
    switch (format) {
      case 'clash':
        return 'text/yaml; charset=utf-8';
      case 'mieru':
        return 'text/yaml; charset=utf-8';
      case 'singbox':
        return 'application/json; charset=utf-8';
      case 'wireguard':
        return 'text/plain; charset=utf-8';
      case 'v2ray':
      default:
        return 'text/plain; charset=utf-8';
    }
  }

  getFileExtension(format) {
    switch (format) {
      case 'clash':
        return 'yaml';
      case 'mieru':
        return 'yaml';
      case 'singbox':
        return 'json';
      case 'wireguard':
        return 'conf';
      case 'v2ray':
      default:
        return 'txt';
    }
  }
}

module.exports = new ClientDetector();
