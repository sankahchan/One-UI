/**
 * Search Service
 * Provides full-text search across users, inbounds, and groups
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class SearchService {
    /**
     * Search across users, inbounds, and groups
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @returns {{ users: Array, inbounds: Array, groups: Array, total: number }}
     */
    async search(query, options = {}) {
        const { limit = 10, type = 'all' } = options;

        if (!query || query.trim().length < 2) {
            return { users: [], inbounds: [], groups: [], total: 0 };
        }

        const searchTerm = query.trim().toLowerCase();
        const results = { users: [], inbounds: [], groups: [], total: 0 };

        // Search users
        if (type === 'all' || type === 'users') {
            const users = await prisma.user.findMany({
                where: {
                    OR: [
                        { email: { contains: searchTerm, mode: 'insensitive' } },
                        { uuid: { contains: searchTerm, mode: 'insensitive' } },
                        { note: { contains: searchTerm, mode: 'insensitive' } },
                        { telegramUsername: { contains: searchTerm, mode: 'insensitive' } }
                    ]
                },
                select: {
                    id: true,
                    email: true,
                    uuid: true,
                    status: true,
                    expireDate: true,
                    dataLimit: true,
                    uploadUsed: true,
                    downloadUsed: true
                },
                take: limit,
                orderBy: { email: 'asc' }
            });

            results.users = users.map(u => ({
                ...u,
                type: 'user',
                label: u.email,
                sublabel: `${u.status} • UUID: ${u.uuid.substring(0, 8)}...`
            }));
        }

        // Search inbounds
        if (type === 'all' || type === 'inbounds') {
            const inbounds = await prisma.inbound.findMany({
                where: {
                    OR: [
                        { tag: { contains: searchTerm, mode: 'insensitive' } },
                        { remark: { contains: searchTerm, mode: 'insensitive' } },
                        { serverAddress: { contains: searchTerm, mode: 'insensitive' } },
                        { serverName: { contains: searchTerm, mode: 'insensitive' } }
                    ]
                },
                select: {
                    id: true,
                    port: true,
                    protocol: true,
                    tag: true,
                    remark: true,
                    enabled: true,
                    serverAddress: true
                },
                take: limit,
                orderBy: { port: 'asc' }
            });

            results.inbounds = inbounds.map(i => ({
                ...i,
                type: 'inbound',
                label: i.remark || i.tag,
                sublabel: `${i.protocol} • Port ${i.port} • ${i.enabled ? 'Active' : 'Disabled'}`
            }));
        }

        // Search groups
        if (type === 'all' || type === 'groups') {
            const groups = await prisma.group.findMany({
                where: {
                    OR: [
                        { name: { contains: searchTerm, mode: 'insensitive' } },
                        { remark: { contains: searchTerm, mode: 'insensitive' } }
                    ]
                },
                select: {
                    id: true,
                    name: true,
                    remark: true,
                    isDisabled: true,
                    _count: { select: { users: true } }
                },
                take: limit,
                orderBy: { name: 'asc' }
            });

            results.groups = groups.map(g => ({
                ...g,
                type: 'group',
                label: g.name,
                sublabel: `Group • ${g._count.users} members`
            }));
        }

        results.total = results.users.length + results.inbounds.length + results.groups.length;
        return results;
    }

    /**
     * Quick search for autocomplete
     * @param {string} query - Search query
     * @returns {Array} - Flat array of results
     */
    async quickSearch(query) {
        const results = await this.search(query, { limit: 5 });
        return [
            ...results.users,
            ...results.inbounds,
            ...results.groups
        ].slice(0, 10);
    }
}

module.exports = new SearchService();
