/**
 * Smart Routing Rules
 * Generates routing rules for domestic/filtered sites
 */

const DOMESTIC_IPS = ['geoip:ir', 'geoip:cn', 'geoip:ru'];
const DOMESTIC_DOMAINS = ['geosite:ir', 'geosite:cn', 'geosite:ru'];

class SmartRoutingRules {
    /**
     * Generate routing rules based on mode
     * @param {string} mode - 'all', 'filtered', 'smart' (smart = domestic bypass)
     */
    generateRules(mode = 'smart') {
        const rules = [
            // Standard blocking rules
            {
                type: 'field',
                ip: ['geoip:private'],
                outboundTag: 'blocked'
            },
            {
                type: 'field',
                protocol: ['bittorrent'],
                outboundTag: 'blocked'
            }
        ];

        if (mode === 'smart' || mode === 'filtered') {
            // Direct connection for domestic IPs/Domains
            rules.push({
                type: 'field',
                ip: DOMESTIC_IPS,
                outboundTag: 'direct'
            });
            rules.push({
                type: 'field',
                domain: DOMESTIC_DOMAINS,
                outboundTag: 'direct'
            });
        }

        return rules;
    }
}

module.exports = new SmartRoutingRules();
