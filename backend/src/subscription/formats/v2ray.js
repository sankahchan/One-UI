const URLBuilder = require('./url-builder');

class V2RayFormat {
  generate(user, inbounds) {
    const urls = [];

    for (const userInbound of inbounds) {
      const inbound = userInbound.inbound;

      if (!userInbound.enabled || !inbound.enabled) {
        continue;
      }

      const url = URLBuilder.buildProtocolURL(inbound.protocol, user, inbound);

      if (url) {
        urls.push(url);
      }
    }

    if (urls.length === 0) {
      throw new Error('No active proxies found for selected format');
    }

    const combined = urls.join('\n');
    return Buffer.from(combined).toString('base64');
  }
}

module.exports = new V2RayFormat();
