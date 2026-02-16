/**
 * API Key Service
 * Handles creation, validation, and revocation of API keys
 */

const prisma = require('../config/database');
const crypto = require('crypto');

class ApiKeyService {
    /**
     * Generate a secure API key
     * @returns {string}
     */
    generateKey() {
        return `oneui_${crypto.randomBytes(32).toString('hex')}`;
    }

    /**
     * Create a new API key
     * @param {Object} data - API key data
     * @param {number} data.adminId - Admin ID
     * @param {string} data.name - Key name
     * @param {string[]} data.permissions - Permissions array
     * @param {Date} data.expiresAt - Expiration date (optional)
     * @returns {Promise<Object>}
     */
    async create(data) {
        const { adminId, name, permissions = [], expiresAt } = data;

        const key = this.generateKey();

        const apiKey = await prisma.apiKey.create({
            data: {
                name,
                key,
                adminId,
                permissions,
                expiresAt
            },
            include: {
                admin: {
                    select: { id: true, username: true }
                }
            }
        });

        // Return with plain key (only shown once)
        return {
            ...apiKey,
            plainKey: key
        };
    }

    /**
     * Validate an API key
     * @param {string} key - API key to validate
     * @returns {Promise<Object|null>}
     */
    async validate(key) {
        if (!key || !key.startsWith('oneui_')) {
            return null;
        }

        const apiKey = await prisma.apiKey.findUnique({
            where: { key },
            include: {
                admin: {
                    select: { id: true, username: true, role: true }
                }
            }
        });

        if (!apiKey) {
            return null;
        }

        // Check if expired
        if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
            return null;
        }

        // Update last used timestamp
        await prisma.apiKey.update({
            where: { id: apiKey.id },
            data: { lastUsedAt: new Date() }
        });

        return apiKey;
    }

    /**
     * List all API keys for an admin
     * @param {number} adminId - Admin ID (optional, lists all if not provided)
     * @returns {Promise<Array>}
     */
    async list(adminId = null) {
        const where = adminId ? { adminId } : {};

        return prisma.apiKey.findMany({
            where,
            select: {
                id: true,
                name: true,
                permissions: true,
                lastUsedAt: true,
                expiresAt: true,
                createdAt: true,
                admin: {
                    select: { id: true, username: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
    }

    /**
     * Revoke an API key
     * @param {number} id - API key ID
     * @param {number} adminId - Admin ID (for authorization check)
     * @returns {Promise<void>}
     */
    async revoke(id, adminId = null) {
        const where = { id };

        // If adminId provided, ensure the key belongs to this admin
        if (adminId) {
            where.adminId = adminId;
        }

        const apiKey = await prisma.apiKey.findFirst({ where });

        if (!apiKey) {
            throw new Error('API key not found or unauthorized');
        }

        await prisma.apiKey.delete({
            where: { id }
        });
    }

    /**
     * Get API key by ID
     * @param {number} id 
     * @returns {Promise<Object|null>}
     */
    async getById(id) {
        return prisma.apiKey.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                permissions: true,
                lastUsedAt: true,
                expiresAt: true,
                createdAt: true,
                admin: {
                    select: { id: true, username: true }
                }
            }
        });
    }
}

module.exports = new ApiKeyService();
