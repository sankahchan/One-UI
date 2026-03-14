const prisma = require('../config/database');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errors');
const logger = require('../config/logger');

const ALLOWED_PROTOCOLS = ['FREEDOM', 'BLACKHOLE', 'SOCKS', 'HTTP', 'TROJAN', 'VMESS', 'VLESS', 'SHADOWSOCKS'];

class OutboundService {
  async list({ page = 1, limit = 50 } = {}) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      prisma.outbound.findMany({
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: limit
      }),
      prisma.outbound.count()
    ]);

    return {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 }
    };
  }

  async getById(id) {
    const outbound = await prisma.outbound.findUnique({ where: { id } });
    if (!outbound) throw new NotFoundError('Outbound not found');
    return outbound;
  }

  async create(data) {
    if (!data.tag?.trim()) throw new ValidationError('tag is required');
    if (!ALLOWED_PROTOCOLS.includes(data.protocol)) throw new ValidationError('Invalid protocol');
    if (!data.address?.trim()) throw new ValidationError('address is required');
    if (!data.port || data.port < 1 || data.port > 65535) throw new ValidationError('port must be between 1 and 65535');

    const existing = await prisma.outbound.findUnique({ where: { tag: data.tag } });
    if (existing) throw new ConflictError('Outbound with this tag already exists');

    return prisma.outbound.create({
      data: {
        tag: data.tag.trim(),
        protocol: data.protocol,
        address: data.address.trim(),
        port: data.port,
        enabled: data.enabled ?? true,
        remark: data.remark || null,
        settings: data.settings || {},
        streamSettings: data.streamSettings || null,
        mux: data.mux || null,
        priority: data.priority ?? 100
      }
    });
  }

  async update(id, data) {
    const outbound = await this.getById(id);

    if (data.tag && data.tag !== outbound.tag) {
      const existing = await prisma.outbound.findUnique({ where: { tag: data.tag } });
      if (existing) throw new ConflictError('Outbound with this tag already exists');
    }

    const updateData = {};
    if (data.tag !== undefined) updateData.tag = data.tag.trim();
    if (data.protocol !== undefined) updateData.protocol = data.protocol;
    if (data.address !== undefined) updateData.address = data.address.trim();
    if (data.port !== undefined) updateData.port = data.port;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.remark !== undefined) updateData.remark = data.remark || null;
    if (data.settings !== undefined) updateData.settings = data.settings;
    if (data.streamSettings !== undefined) updateData.streamSettings = data.streamSettings;
    if (data.mux !== undefined) updateData.mux = data.mux;
    if (data.priority !== undefined) updateData.priority = data.priority;

    return prisma.outbound.update({ where: { id }, data: updateData });
  }

  async delete(id) {
    await this.getById(id);
    return prisma.outbound.delete({ where: { id } });
  }

  async toggle(id) {
    const outbound = await this.getById(id);
    return prisma.outbound.update({
      where: { id },
      data: { enabled: !outbound.enabled }
    });
  }

  toXrayOutbound(outbound) {
    const protocol = outbound.protocol.toLowerCase();
    const base = {
      tag: outbound.tag,
      protocol,
      settings: this._buildProtocolSettings(outbound),
    };

    if (outbound.streamSettings) {
      base.streamSettings = typeof outbound.streamSettings === 'string'
        ? JSON.parse(outbound.streamSettings)
        : outbound.streamSettings;
    }

    if (outbound.mux) {
      base.mux = typeof outbound.mux === 'string'
        ? JSON.parse(outbound.mux)
        : outbound.mux;
    }

    return base;
  }

  _buildProtocolSettings(outbound) {
    const protocol = outbound.protocol.toUpperCase();
    const raw = typeof outbound.settings === 'string'
      ? JSON.parse(outbound.settings)
      : (outbound.settings || {});

    switch (protocol) {
      case 'VMESS':
      case 'VLESS':
        return {
          vnext: [{
            address: outbound.address,
            port: outbound.port,
            users: [{
              id: raw.uuid || raw.id || '',
              alterId: raw.alterId || 0,
              security: raw.security || 'auto',
              encryption: raw.encryption || 'none',
              flow: raw.flow || ''
            }]
          }]
        };
      case 'TROJAN':
        return {
          servers: [{
            address: outbound.address,
            port: outbound.port,
            password: raw.password || ''
          }]
        };
      case 'SOCKS':
      case 'HTTP':
        return {
          servers: [{
            address: outbound.address,
            port: outbound.port,
            users: raw.username ? [{ user: raw.username, pass: raw.password || '' }] : []
          }]
        };
      case 'SHADOWSOCKS':
        return {
          servers: [{
            address: outbound.address,
            port: outbound.port,
            method: raw.method || 'aes-256-gcm',
            password: raw.password || ''
          }]
        };
      case 'FREEDOM':
        return raw;
      case 'BLACKHOLE':
        return raw.type ? { response: { type: raw.type } } : {};
      default:
        return raw;
    }
  }
}

module.exports = new OutboundService();
