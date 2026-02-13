/**
 * DNS over HTTPS (DoH) Routes
 * RFC 8484 compliant endpoint for encrypted DNS
 */

const express = require('express');
const dns = require('dns');
const { promisify } = require('util');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const router = express.Router();
const resolve4 = promisify(dns.resolve4);
const resolve6 = promisify(dns.resolve6);

// Default upstream DoH provider (Cloudflare)
const UPSTREAM_DOH = 'https://cloudflare-dns.com/dns-query';

/**
 * Handle DNS query
 * GET /dns-query?dns=...
 * POST /dns-query (body)
 */
async function handleDohRequest(req, res, next) {
    try {
        const { dns } = req.query;
        const accept = req.headers.accept;
        const contentType = req.headers['content-type'];

        let packet;

        if (req.method === 'GET' && dns) {
            packet = Buffer.from(dns, 'base64');
        } else if (req.method === 'POST') {
            // For POST, body is the packet
            if (contentType !== 'application/dns-message') {
                return res.status(415).send('Unsupported Media Type');
            }
            packet = req.body;
        } else {
            return res.status(400).send('Bad Request');
        }

        // Forward to upstream
        const response = await fetch(UPSTREAM_DOH, {
            method: 'POST',
            headers: {
                'Accept': 'application/dns-message',
                'Content-Type': 'application/dns-message',
                'Content-Length': packet.length
            },
            body: packet
        });

        if (!response.ok) {
            return res.status(response.status).send(response.statusText);
        }

        const responseBuffer = await response.buffer();

        res.set({
            'Content-Type': 'application/dns-message',
            'Content-Length': responseBuffer.length
        });

        return res.send(responseBuffer);
    } catch (error) {
        // If upstream fails, we could fallback to local DNS, 
        // but DoH packets are binary and hard to construct without a library like dns-packet.
        // For now, just proxy to Cloudflare.
        console.error('[DoH] Error forwarding DNS query:', error);
        return res.status(502).send('Bad Gateway');
    }
}

// Support raw body for binary DNS packets
router.use(express.raw({ type: 'application/dns-message', limit: '512b' }));

router.get('/', handleDohRequest);
router.post('/', handleDohRequest);

module.exports = router;
