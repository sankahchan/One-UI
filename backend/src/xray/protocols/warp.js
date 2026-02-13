/**
 * WARP WireGuard Outbound Generator
 * Generates WireGuard outbound for Cloudflare WARP
 */

class WarpOutbound {
    constructor() {
        this.protocol = 'wireguard';
    }

    generateOutbound(config) {
        if (!config || !config.enabled) return null;

        // Default WARP endpoint (can be overridden)
        const endpoint = config.endpoint || 'engage.cloudflareclient.com:2408';

        return {
            protocol: 'wireguard',
            tag: 'warp',
            settings: {
                secretKey: config.privateKey,
                peers: [
                    {
                        publicKey: config.publicKey || 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=', // Default WARP public key
                        endpoint: endpoint
                    }
                ],
                address: config.address ? [config.address] : ['172.16.0.2/32', '2606:4700:110:8f62:8495:3f23:45c3:d296/128']
            }
        };
    }

    generateRoutingRule(config) {
        if (!config || !config.enabled) return null;

        // Route specific traffic through WARP (e.g., Netflix, ChatGPT)
        // For now, we return a simple rule that can be added to the routing array
        return {
            type: 'field',
            domain: ['geosite:netflix', 'geosite:openai'],
            outboundTag: 'warp'
        };
    }
}

module.exports = new WarpOutbound();
