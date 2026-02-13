#!/usr/bin/env node

/**
 * One-UI CLI Tool
 * Command-line interface for server management
 * 
 * Usage:
 *   one-ui user list
 *   one-ui user create <email> [--data-limit=50] [--expiry-days=30]
 *   one-ui user reset-traffic <email|id>
 *   one-ui user delete <email|id>
 *   one-ui backup create
 *   one-ui backup list
 *   one-ui xray restart
 *   one-ui xray status
 */

const { Command } = require('commander');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();
const program = new Command();

program
    .name('one-ui')
    .description('One-UI VPN Panel CLI')
    .version('1.0.0');

// =============== USER COMMANDS ===============

const userCmd = program.command('user').description('User management commands');

userCmd
    .command('list')
    .description('List all users')
    .option('-s, --status <status>', 'Filter by status (ACTIVE, EXPIRED, DISABLED, LIMITED)')
    .option('-l, --limit <number>', 'Limit number of results', '20')
    .action(async (options) => {
        try {
            const where = {};
            if (options.status) {
                where.status = options.status.toUpperCase();
            }

            const users = await prisma.user.findMany({
                where,
                take: parseInt(options.limit),
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    email: true,
                    status: true,
                    dataLimit: true,
                    uploadUsed: true,
                    downloadUsed: true,
                    expireDate: true
                }
            });

            console.log('\n📋 Users:');
            console.log('─'.repeat(80));

            if (users.length === 0) {
                console.log('  No users found.');
            } else {
                users.forEach(user => {
                    const used = Number(user.uploadUsed) + Number(user.downloadUsed);
                    const limit = Number(user.dataLimit);
                    const usedGB = (used / (1024 ** 3)).toFixed(2);
                    const limitGB = limit > 0 ? (limit / (1024 ** 3)).toFixed(0) : '∞';
                    const expiry = new Date(user.expireDate).toLocaleDateString();

                    console.log(`  [${user.id}] ${user.email}`);
                    console.log(`      Status: ${user.status} | Data: ${usedGB}/${limitGB} GB | Expires: ${expiry}`);
                });
            }

            console.log('─'.repeat(80));
            console.log(`Total: ${users.length} users\n`);
        } catch (error) {
            console.error('❌ Error:', error.message);
        } finally {
            await prisma.$disconnect();
        }
    });

userCmd
    .command('create <email>')
    .description('Create a new user')
    .option('-d, --data-limit <gb>', 'Data limit in GB', '50')
    .option('-e, --expiry-days <days>', 'Days until expiry', '30')
    .action(async (email, options) => {
        try {
            const dataLimit = BigInt(parseInt(options.dataLimit) * 1024 ** 3);
            const expiryDays = parseInt(options.expiryDays);
            const expireDate = new Date();
            expireDate.setDate(expireDate.getDate() + expiryDays);

            const user = await prisma.user.create({
                data: {
                    email,
                    uuid: uuidv4(),
                    password: crypto.randomBytes(16).toString('hex'),
                    subscriptionToken: crypto.randomBytes(32).toString('hex'),
                    dataLimit,
                    expireDate
                }
            });

            console.log('\n✅ User created successfully!');
            console.log('─'.repeat(50));
            console.log(`  Email: ${user.email}`);
            console.log(`  UUID: ${user.uuid}`);
            console.log(`  Token: ${user.subscriptionToken}`);
            console.log(`  Data Limit: ${options.dataLimit} GB`);
            console.log(`  Expires: ${expireDate.toLocaleDateString()}`);
            console.log('─'.repeat(50) + '\n');
        } catch (error) {
            if (error.code === 'P2002') {
                console.error('❌ Error: User with this email already exists.');
            } else {
                console.error('❌ Error:', error.message);
            }
        } finally {
            await prisma.$disconnect();
        }
    });

userCmd
    .command('reset-traffic <identifier>')
    .description('Reset traffic for a user (by email or ID)')
    .action(async (identifier) => {
        try {
            const where = {};
            if (/^\d+$/.test(identifier)) {
                where.id = parseInt(identifier);
            } else {
                where.email = identifier;
            }

            const user = await prisma.user.update({
                where,
                data: {
                    uploadUsed: 0,
                    downloadUsed: 0,
                    lastTrafficReset: new Date(),
                    status: 'ACTIVE'
                }
            });

            console.log(`\n✅ Traffic reset for user: ${user.email}\n`);
        } catch (error) {
            if (error.code === 'P2025') {
                console.error('❌ Error: User not found.');
            } else {
                console.error('❌ Error:', error.message);
            }
        } finally {
            await prisma.$disconnect();
        }
    });

userCmd
    .command('delete <identifier>')
    .description('Delete a user (by email or ID)')
    .action(async (identifier) => {
        try {
            const where = {};
            if (/^\d+$/.test(identifier)) {
                where.id = parseInt(identifier);
            } else {
                where.email = identifier;
            }

            // First delete related records
            const user = await prisma.user.findUnique({ where });
            if (!user) {
                console.error('❌ Error: User not found.');
                return;
            }

            await prisma.userInbound.deleteMany({ where: { userId: user.id } });
            await prisma.trafficLog.deleteMany({ where: { userId: user.id } });
            await prisma.connectionLog.deleteMany({ where: { userId: user.id } });
            await prisma.user.delete({ where: { id: user.id } });

            console.log(`\n✅ User deleted: ${user.email}\n`);
        } catch (error) {
            console.error('❌ Error:', error.message);
        } finally {
            await prisma.$disconnect();
        }
    });

// =============== BACKUP COMMANDS ===============

const backupCmd = program.command('backup').description('Backup management commands');

backupCmd
    .command('create')
    .description('Create a new backup')
    .action(async () => {
        try {
            const backupManager = require('../backup/manager');
            const archivePath = await backupManager.createBackup();
            console.log(`\n✅ Backup created: ${archivePath}\n`);
        } catch (error) {
            console.error('❌ Error:', error.message);
        }
    });

backupCmd
    .command('list')
    .description('List available backups')
    .action(async () => {
        try {
            const backupManager = require('../backup/manager');
            const backups = await backupManager.listBackups();

            console.log('\n📦 Available Backups:');
            console.log('─'.repeat(60));

            if (backups.length === 0) {
                console.log('  No backups found.');
            } else {
                backups.forEach(backup => {
                    console.log(`  ${backup.filename} (${(backup.size / 1024 / 1024).toFixed(2)} MB)`);
                    console.log(`      Created: ${new Date(backup.createdAt).toLocaleString()}`);
                });
            }

            console.log('─'.repeat(60) + '\n');
        } catch (error) {
            console.error('❌ Error:', error.message);
        }
    });

// =============== XRAY COMMANDS ===============

const xrayCmd = program.command('xray').description('Xray service commands');

xrayCmd
    .command('restart')
    .description('Restart Xray service')
    .action(async () => {
        try {
            const xrayManager = require('../xray/manager');
            await xrayManager.restart();
            console.log('\n✅ Xray service restarted successfully.\n');
        } catch (error) {
            console.error('❌ Error:', error.message);
        }
    });

xrayCmd
    .command('status')
    .description('Check Xray service status')
    .action(async () => {
        try {
            const xrayManager = require('../xray/manager');
            const status = await xrayManager.getStatus();

            console.log('\n📊 Xray Status:');
            console.log('─'.repeat(40));
            console.log(`  Running: ${status.running ? '✅ Yes' : '❌ No'}`);
            console.log(`  Version: ${status.version || 'Unknown'}`);
            console.log(`  Uptime: ${status.uptime || 'N/A'}`);
            console.log('─'.repeat(40) + '\n');
        } catch (error) {
            console.error('❌ Error:', error.message);
        }
    });

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
    program.outputHelp();
}
