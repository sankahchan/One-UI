/**
 * Wireguard Protocol Handler
 * Generates Xray outbound config for Wireguard
 * Note: Wireguard in Xray is typically used as an outbound, not inbound
 */

const crypto = require('crypto');

class WireguardProtocol {
    /**
     * Generate Wireguard key pair using Curve25519
     * Note: This is a simplified implementation.
     * For production, use proper Wireguard key generation.
     * @returns {Object} - { privateKey, publicKey }
     */
    generateKeyPair() {
        // Generate 32 random bytes for private key
        const privateKeyBytes = crypto.randomBytes(32);

        // Clamp the private key per Curve25519 spec
        privateKeyBytes[0] &= 248;
        privateKeyBytes[31] &= 127;
        privateKeyBytes[31] |= 64;

        const privateKey = privateKeyBytes.toString('base64');

        // For actual public key derivation, you'd need proper Curve25519
        // This is a placeholder - in production use wireguard-tools or similar
        const publicKey = crypto.createHash('sha256')
            .update(privateKeyBytes)
            .digest()
            .slice(0, 32)
            .toString('base64');

        return { privateKey, publicKey };
    }

    /**
     * Generate Wireguard outbound configuration
     * Wireguard is used as an outbound proxy in Xray
     * @param {Object} inbound - Database inbound record (used as outbound config)
     * @returns {Object|null} - Xray outbound config
     */
    generateOutbound(inbound) {
        if (!inbound.wgPrivateKey || !inbound.wgPeerPublicKey) {
            return null;
        }

        return {
            protocol: 'wireguard',
            tag: inbound.tag || 'wireguard-out',
            settings: {
                secretKey: inbound.wgPrivateKey,
                address: inbound.wgAllowedIPs?.split(',').map(ip => ip.trim()) || ['10.0.0.2/32'],
                peers: [{
                    publicKey: inbound.wgPeerPublicKey,
                    endpoint: inbound.wgPeerEndpoint || '',
                    allowedIPs: ['0.0.0.0/0', '::/0']
                }],
                mtu: inbound.wgMtu || 1420,
                reserved: [0, 0, 0]
            }
        };
    }

    /**
     * Generate Wireguard inbound configuration
     * This creates a local listener that tunnels through Wireguard
     * @param {Object} inbound - Database inbound record
     * @returns {Object|null} - Xray inbound config
     */
    generateInbound(inbound) {
        // Wireguard as inbound uses dokodemo-door or socks with WG outbound
        // For simplicity, we create a SOCKS5 proxy that routes via Wireguard

        const wgOutbound = this.generateOutbound(inbound);
        if (!wgOutbound) {
            return null;
        }

        // Return both the inbound listener and the WG outbound
        return {
            inbound: {
                listen: '0.0.0.0',
                port: inbound.port,
                protocol: 'socks',
                tag: `${inbound.tag}-in`,
                settings: {
                    auth: 'noauth',
                    udp: true
                }
            },
            outbound: wgOutbound,
            routingRule: {
                type: 'field',
                inboundTag: [`${inbound.tag}-in`],
                outboundTag: inbound.tag
            }
        };
    }

    /**
     * Generate Wireguard config file format (wg-quick compatible)
     * @param {Object} config - Wireguard configuration
     * @returns {string} - Wireguard config file content
     */
    generateConfigFile(config) {
        const lines = [
            '[Interface]',
            `PrivateKey = ${config.privateKey}`,
            `Address = ${config.address || '10.0.0.2/32'}`
        ];

        if (config.dns) {
            lines.push(`DNS = ${config.dns}`);
        }

        if (config.mtu) {
            lines.push(`MTU = ${config.mtu}`);
        }

        lines.push('');
        lines.push('[Peer]');
        lines.push(`PublicKey = ${config.peerPublicKey}`);

        if (config.presharedKey) {
            lines.push(`PresharedKey = ${config.presharedKey}`);
        }

        lines.push(`Endpoint = ${config.endpoint}`);
        lines.push(`AllowedIPs = ${config.allowedIPs || '0.0.0.0/0, ::/0'}`);

        if (config.persistentKeepalive) {
            lines.push(`PersistentKeepalive = ${config.persistentKeepalive}`);
        }

        return lines.join('\n');
    }

    /**
     * Generate client Wireguard config for user
     * @param {Object} inbound - Inbound config
     * @param {Object} user - User object
     * @returns {string} - Wireguard config file
     */
    generateClientConfig(inbound, user) {
        // Generate unique address for this user based on user ID
        const userOctet = (user.id % 254) + 1;

        return this.generateConfigFile({
            privateKey: user.wgPrivateKey || '<USER_PRIVATE_KEY>',
            address: `10.0.0.${userOctet}/32`,
            dns: '1.1.1.1, 8.8.8.8',
            mtu: inbound.wgMtu || 1420,
            peerPublicKey: inbound.wgPublicKey || '<SERVER_PUBLIC_KEY>',
            endpoint: `${inbound.serverAddress}:${inbound.port}`,
            allowedIPs: '0.0.0.0/0, ::/0',
            persistentKeepalive: 25
        });
    }
}

module.exports = new WireguardProtocol();
