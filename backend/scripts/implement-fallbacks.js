const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const manager = require('../src/xray/manager');

async function seedFallbacks() {
    try {
        console.log('Seeding internal Trojan inbound on port 10001...');
        await prisma.inbound.upsert({
            where: { port: 10001 },
            update: {
                protocol: 'TROJAN',
                network: 'TCP',
                security: 'NONE',
                tag: 'internal-trojan',
                serverAddress: '127.0.0.1',
                remark: 'Internal Trojan (Fallback)'
            },
            create: {
                port: 10001,
                protocol: 'TROJAN',
                network: 'TCP',
                security: 'NONE',
                tag: 'internal-trojan',
                serverAddress: '127.0.0.1',
                remark: 'Internal Trojan (Fallback)',
                enabled: true
            }
        });

        console.log('Seeding internal VMess inbound on port 10002...');
        await prisma.inbound.upsert({
            where: { port: 10002 },
            update: {
                protocol: 'VMESS',
                network: 'WS',
                security: 'NONE',
                wsPath: '/vmess',
                tag: 'internal-vmess',
                serverAddress: '127.0.0.1',
                remark: 'Internal VMess WS (Fallback)'
            },
            create: {
                port: 10002,
                protocol: 'VMESS',
                network: 'WS',
                security: 'NONE',
                wsPath: '/vmess',
                tag: 'internal-vmess',
                serverAddress: '127.0.0.1',
                remark: 'Internal VMess WS (Fallback)',
                enabled: true
            }
        });

        console.log('Seeding primary VLESS Master inbound on port 443...');
        await prisma.inbound.upsert({
            where: { port: 443 },
            update: {
                protocol: 'VLESS',
                network: 'TCP',
                security: 'TLS',
                tag: 'master-vless-443',
                serverName: 'example.com',
                serverAddress: '0.0.0.0',
                alpn: 'h2,http/1.1',
                remark: 'Primary VLESS Port 443 (Multiplexer)',
                fallbacks: [
                    { path: '/vmess', dest: 10002, xver: 1 },
                    { alpn: 'h2', dest: 10001, xver: 1 },
                    { dest: 80, xver: 0 }
                ]
            },
            create: {
                port: 443,
                protocol: 'VLESS',
                network: 'TCP',
                security: 'TLS',
                tag: 'master-vless-443',
                serverName: 'example.com',
                serverAddress: '0.0.0.0',
                alpn: 'h2,http/1.1',
                remark: 'Primary VLESS Port 443 (Multiplexer)',
                enabled: true,
                fallbacks: [
                    { path: '/vmess', dest: 10002, xver: 1 },
                    { alpn: 'h2', dest: 10001, xver: 1 },
                    { dest: 80, xver: 0 }
                ]
            }
        });

        console.log('Regenerating Xray config and applying hot-reload...');
        await manager.applyGeneratedConfig();
        console.log('Successfully implemented Fallback architecture!');

    } catch (error) {
        console.error('Failed to seed fallbacks:', error);
    } finally {
        await prisma.$disconnect();
    }
}

seedFallbacks();
