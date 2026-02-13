/**
 * REALITY Protocol Handler
 * Generates Xray inbound config for VLESS with REALITY security
 */

class RealityProtocol {
    buildHttpUpgradeSettings(inbound) {
        const settings = {
            path: inbound.wsPath || '/'
        };

        if (inbound.wsHost) {
            settings.host = String(inbound.wsHost).trim();
        }

        return settings;
    }

    buildXhttpSettings(inbound) {
        const settings = {
            path: inbound.wsPath || '/'
        };

        if (inbound.wsHost) {
            const hosts = String(inbound.wsHost)
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean);

            if (hosts.length > 0) {
                settings.host = hosts;
            }
        }

        if (inbound.xhttpMode) {
            settings.mode = inbound.xhttpMode;
        }

        return settings;
    }

    getPrimaryShortId(inbound) {
        if (Array.isArray(inbound.realityShortIds) && inbound.realityShortIds.length > 0) {
            return inbound.realityShortIds[0];
        }
        return inbound.realityShortId || '';
    }

    getServerNames(inbound) {
        if (Array.isArray(inbound.realityServerNames) && inbound.realityServerNames.length > 0) {
            return inbound.realityServerNames;
        }
        return [inbound.serverName || 'www.microsoft.com'];
    }

    /**
     * Generate REALITY stream settings
     * @param {Object} inbound - Inbound configuration
     * @returns {Object} - REALITY stream settings
     */
    generateRealitySettings(inbound) {
        const settings = {
            show: false,
            dest: inbound.realityDest || `${inbound.serverName || 'www.microsoft.com'}:443`,
            xver: 0,
            serverNames: this.getServerNames(inbound),
            privateKey: inbound.realityPrivateKey || '',
            shortIds: this.getPrimaryShortId(inbound) ? [this.getPrimaryShortId(inbound)] : [''],
            fingerprint: inbound.realityFingerprint || 'chrome'
        };

        if (inbound.realitySpiderX) {
            settings.spiderX = inbound.realitySpiderX;
        }

        return settings;
    }

    /**
     * Generate inbound configuration for VLESS + REALITY
     * @param {Object} inbound - Database inbound record
     * @returns {Object|null} - Xray inbound config
     */
    generateInbound(inbound) {
        // Extract users from userInbounds
        const clients = inbound.userInbounds.map(ui => ({
            id: ui.user.uuid,
            email: ui.user.email,
            level: 0,
            flow: 'xtls-rprx-vision' // Required for REALITY
        }));

        if (clients.length === 0) {
            return null; // Skip inbound if no active users
        }

        const config = {
            listen: '0.0.0.0',
            port: inbound.port,
            protocol: 'vless',
            tag: inbound.tag,
            settings: {
                clients,
                decryption: 'none'
            },
            streamSettings: {
                network: inbound.network?.toLowerCase() || 'tcp',
                security: 'reality',
                realitySettings: this.generateRealitySettings(inbound)
            },
            sniffing: {
                enabled: true,
                destOverride: ['http', 'tls', 'quic']
            }
        };

        // Network-specific settings
        if (inbound.network === 'TCP') {
            config.streamSettings.tcpSettings = {
                header: { type: 'none' }
            };
        } else if (inbound.network === 'GRPC') {
            config.streamSettings.grpcSettings = {
                serviceName: inbound.grpcServiceName || ''
            };
        } else if (inbound.network === 'HTTPUPGRADE') {
            config.streamSettings.httpupgradeSettings = this.buildHttpUpgradeSettings(inbound);
        } else if (inbound.network === 'XHTTP') {
            config.streamSettings.xhttpSettings = this.buildXhttpSettings(inbound);
        }

        return config;
    }

    /**
     * Generate client-side REALITY config for subscription
     * @param {Object} inbound - Inbound config
     * @param {Object} user - User object
     * @returns {Object} - Client config
     */
    generateClientConfig(inbound, user) {
        return {
            protocol: 'vless',
            settings: {
                vnext: [{
                    address: inbound.serverAddress,
                    port: inbound.port,
                    users: [{
                        id: user.uuid,
                        encryption: 'none',
                        flow: 'xtls-rprx-vision'
                    }]
                }]
            },
            streamSettings: {
                network: inbound.network?.toLowerCase() || 'tcp',
                security: 'reality',
                realitySettings: {
                    serverName: inbound.serverName || 'www.microsoft.com',
                    fingerprint: inbound.realityFingerprint || 'chrome',
                    publicKey: inbound.realityPublicKey || '',
                    shortId: this.getPrimaryShortId(inbound),
                    spiderX: inbound.realitySpiderX || ''
                }
            }
        };
    }

    /**
     * Generate VLESS REALITY share link
     * @param {Object} inbound - Inbound config
     * @param {Object} user - User object
     * @returns {string} - Share link
     */
    generateShareLink(inbound, user) {
        const params = new URLSearchParams({
            type: inbound.network?.toLowerCase() || 'tcp',
            security: 'reality',
            pbk: inbound.realityPublicKey || '',
            fp: inbound.realityFingerprint || 'chrome',
            sni: inbound.serverName || 'www.microsoft.com',
            sid: this.getPrimaryShortId(inbound),
            flow: 'xtls-rprx-vision'
        });

        if (inbound.realitySpiderX) {
            params.set('spx', inbound.realitySpiderX);
        }

        const remark = encodeURIComponent(inbound.remark || inbound.tag);
        return `vless://${user.uuid}@${inbound.serverAddress}:${inbound.port}?${params.toString()}#${remark}`;
    }
}

module.exports = new RealityProtocol();
