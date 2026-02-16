/**
 * SingBox Config Generator
 * Generates SingBox JSON configuration from database inbounds
 */

const fs = require('node:fs').promises;
const path = require('node:path');

const prisma = require('../../config/database');

function parseAlpn(raw) {
    if (!raw) return undefined;
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
    } catch {}
    return raw.split(',').map(s => s.trim()).filter(Boolean);
}

class SingBoxConfigGenerator {
    constructor() {
        this.templatePath = path.resolve(__dirname, 'templates', 'base-config.json');
    }

    async loadBaseConfig() {
        try {
            const content = await fs.readFile(this.templatePath, 'utf8');
            return JSON.parse(content);
        } catch (_error) {
            return {
                log: { level: "warn" },
                inbounds: [],
                outbounds: [{ type: "direct", tag: "direct" }],
                route: { rules: [] }
            };
        }
    }

    generateInbound(inbound) {
        const users = inbound.userInbounds?.map((ui) => ({
            name: ui.user.email,
            uuid: ui.user.uuid,
            flow: inbound.network === 'TCP' && inbound.security === 'REALITY' ? 'xtls-rprx-vision' : undefined
        }));

        const baseInbound = {
            type: inbound.protocol.toLowerCase(),
            tag: inbound.tag,
            listen: "0.0.0.0",
            port: inbound.port,
            users
        };

        // Protocol specific settings
        if (inbound.protocol === 'VLESS') {
            // VLESS specific adjustments if needed
        }

        // Transport settings
        if (inbound.network === 'WS') {
            baseInbound.transport = {
                type: 'ws',
                path: inbound.wsPath || '/',
                headers: inbound.wsHost ? { Host: inbound.wsHost } : {}
            };
        } else if (inbound.network === 'HTTPUPGRADE') {
            const transport = {
                type: 'httpupgrade',
                path: inbound.wsPath || '/'
            };
            if (inbound.wsHost) {
                const hosts = String(inbound.wsHost)
                    .split(',')
                    .map((entry) => entry.trim())
                    .filter(Boolean);
                if (hosts.length > 0) {
                    transport.host = hosts;
                }
            }
            baseInbound.transport = transport;
        } else if (inbound.network === 'XHTTP') {
            const transport = {
                type: 'http',
                path: inbound.wsPath || '/'
            };
            if (inbound.wsHost) {
                const hosts = String(inbound.wsHost)
                    .split(',')
                    .map((entry) => entry.trim())
                    .filter(Boolean);
                if (hosts.length > 0) {
                    transport.host = hosts;
                }
            }
            if (inbound.xhttpMode) {
                transport.mode = inbound.xhttpMode;
            }
            baseInbound.transport = transport;
        } else if (inbound.network === 'GRPC') {
            baseInbound.transport = {
                type: 'grpc',
                service_name: inbound.grpcServiceName
            };
        }

        // Security settings
        if (inbound.security === 'TLS') {
            baseInbound.tls = {
                enabled: true,
                server_name: inbound.serverName || inbound.serverAddress,
                alpn: parseAlpn(inbound.alpn),
                certificate_path: process.env.SSL_CERT_PATH,
                key_path: process.env.SSL_KEY_PATH
            };
        } else if (inbound.security === 'REALITY') {
            baseInbound.tls = {
                enabled: true,
                server_name: inbound.serverName || inbound.serverAddress,
                reality: {
                    enabled: true,
                    handshake: {
                        server: inbound.serverName || inbound.serverAddress,
                        server_port: 443
                    },
                    private_key: inbound.realityPrivateKey,
                    short_id: inbound.realityShortIds
                }
            };
        }

        return baseInbound;
    }

    async generateConfig() {
        const config = await this.loadBaseConfig();

        // Fetch active inbounds
        const inbounds = await prisma.inbound.findMany({
            where: { enabled: true },
            include: {
                userInbounds: {
                    where: {
                        enabled: true,
                        user: { status: 'ACTIVE' }
                    },
                    include: { user: true }
                }
            }
        });

        for (const inbound of inbounds) {
            if (inbound.protocol === 'VMESS' || inbound.protocol === 'VLESS' || inbound.protocol === 'TROJAN') {
                config.inbounds.push(this.generateInbound(inbound));
            }
            // SingBox specific implementations for others might vary
        }

        return config;
    }
}

module.exports = new SingBoxConfigGenerator();
