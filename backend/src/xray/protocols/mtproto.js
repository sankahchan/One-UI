/**
 * MTProto Protocol Handler
 */

const crypto = require('crypto');

class MTProtoProtocol {
    constructor() {
        this.protocol = 'mtproto';
    }

    /**
     * Parse user string to hex secret
     */
    parseSecret(secret) {
        if (!secret) return crypto.randomBytes(16).toString('hex');
        // Ensure 32 hex chars
        if (/^[0-9a-fA-F]{32}$/.test(secret)) return secret;
        return secret; // Return as-is if it doesn't match standard hex secret format
    }

    generateInbound(inbound) {
        // Collect users for this inbound
        const users = inbound.userInbounds?.map((ui) => {
            const user = ui.user;
            return {
                secret: this.parseSecret(user.uuid.replace(/-/g, ''))
            };
        }) || [];

        // Add a default user if none exist, or use a static secret if defined in settings
        // For MTProto, we typically use the user's UUID (without dashes) as the secret

        return {
            listen: '0.0.0.0',
            port: inbound.port,
            protocol: 'mtproto',
            tag: inbound.tag,
            settings: {
                users
            },
            sniffing: {
                enabled: true,
                destOverride: ['http', 'tls']
            }
        };
    }

    generateClientConfig(inbound, user, serverAddress) {
        const secret = this.parseSecret(user.uuid.replace(/-/g, ''));

        // MTProto link format: tg://proxy?server=SERVER&port=PORT&secret=SECRET
        const link = `tg://proxy?server=${serverAddress}&port=${inbound.port}&secret=${secret}`;

        // Also support https t.me link
        const tmeLink = `https://t.me/proxy?server=${serverAddress}&port=${inbound.port}&secret=${secret}`;

        return {
            type: 'mtproto',
            tag: inbound.tag,
            server: serverAddress,
            server_port: inbound.port,
            secret,
            link,
            tmeLink
        };
    }
}

module.exports = new MTProtoProtocol();
