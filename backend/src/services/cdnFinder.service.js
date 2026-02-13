/**
 * Auto CDN IP Finder Service
 * Scans Cloudflare IPs to find the best latency/speed
 */

const https = require('https');
const http = require('http');
const { promisify } = require('util');
const dns = require('dns');

// Common Cloudflare IP ranges (IPv4)
const CLOUDFLARE_CIDRS = [
    '104.16.0.0/12',
    '104.17.0.0/12',
    '104.18.0.0/12',
    '104.19.0.0/12',
    '104.20.0.0/12',
    '104.21.0.0/12',
    '104.22.0.0/12',
    '104.24.0.0/12',
    '104.25.0.0/12',
    '104.26.0.0/12',
    '104.27.0.0/12',
    '172.64.0.0/13',
    '162.158.0.0/15',
    '108.162.192.0/18',
    '198.41.128.0/17',
    '173.245.48.0/20',
    '188.114.96.0/20',
    '190.93.240.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17'
];

class CdnFinderService {
    constructor() {
        this.results = [];
        this.isScanning = false;
    }

    /**
     * Expand CIDR to a list of IPs (limited count)
     * @param {string} cidr 
     * @param {number} limit 
     */
    expandCIDR(cidr, limit = 5) {
        const [base, bits] = cidr.split('/');
        const mask = ~(2 ** (32 - parseInt(bits)) - 1);

        // Simple logic to just pick random IPs from the range
        // Converting IP to long and back is tedious, let's just use the base and increment
        const parts = base.split('.').map(Number);
        const ips = [];

        for (let i = 0; i < limit; i++) {
            // Pick a random last octet to avoid first IP
            const randomLast = Math.floor(Math.random() * 254) + 1;
            ips.push(`${parts[0]}.${parts[1]}.${parts[2]}.${randomLast}`);
        }

        return ips;
    }

    /**
     * Test a single IP for latency
     * @param {string} ip 
     */
    async testIP(ip) {
        return new Promise((resolve) => {
            const start = Date.now();
            const req = http.get(`http://${ip}/cdn-cgi/trace`, {
                timeout: 2000,
                headers: {
                    'Host': 'speed.cloudflare.com'
                }
            }, (res) => {
                if (res.statusCode === 200) {
                    const latency = Date.now() - start;
                    resolve({ ip, latency, status: 'OK' });
                } else {
                    resolve({ ip, latency: -1, status: 'ERROR' });
                }
            });

            req.on('error', () => {
                resolve({ ip, latency: -1, status: 'ERROR' });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({ ip, latency: -1, status: 'TIMEOUT' });
            });
        });
    }

    /**
     * Run scanner
     */
    async scan() {
        if (this.isScanning) {
            throw new Error('Scan already in progress');
        }

        this.isScanning = true;
        this.results = [];

        try {
            // Generate list of IPs to test
            let testIps = [];
            for (const cidr of CLOUDFLARE_CIDRS) {
                testIps = testIps.concat(this.expandCIDR(cidr, 2)); // 2 IPs per CIDR range
            }

            // Shuffle
            testIps.sort(() => Math.random() - 0.5);

            // Limit total tests
            testIps = testIps.slice(0, 20);

            // Test in batches
            const batchSize = 5;
            for (let i = 0; i < testIps.length; i += batchSize) {
                const batch = testIps.slice(i, i + batchSize);
                const results = await Promise.all(batch.map(ip => this.testIP(ip)));

                for (const res of results) {
                    if (res.status === 'OK') {
                        this.results.push(res);
                    }
                }
            }

            // Sort by latency
            this.results.sort((a, b) => a.latency - b.latency);

            return this.results;
        } finally {
            this.isScanning = false;
        }
    }

    getResults() {
        return this.results;
    }
}

module.exports = new CdnFinderService();
