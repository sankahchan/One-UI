const prisma = require('../config/database');
const env = require('../config/env');

function normalizeBrandingInput(payload = {}) {
  return {
    scope: String(payload.scope || 'GLOBAL').toUpperCase(),
    enabled: payload.enabled === undefined ? true : Boolean(payload.enabled),
    priority: Number.parseInt(String(payload.priority ?? 100), 10) || 100,
    name: String(payload.name || '').trim(),
    appName: payload.appName ? String(payload.appName).trim() : null,
    logoUrl: payload.logoUrl ? String(payload.logoUrl).trim() : null,
    supportUrl: payload.supportUrl ? String(payload.supportUrl).trim() : null,
    primaryColor: payload.primaryColor ? String(payload.primaryColor).trim() : null,
    accentColor: payload.accentColor ? String(payload.accentColor).trim() : null,
    profileTitle: payload.profileTitle ? String(payload.profileTitle).trim() : null,
    profileDescription: payload.profileDescription ? String(payload.profileDescription).trim() : null,
    customFooter: payload.customFooter ? String(payload.customFooter).trim() : null,
    clashProfileName: payload.clashProfileName ? String(payload.clashProfileName).trim() : null,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : undefined,
    userId: payload.userId ? Number(payload.userId) : null,
    groupId: payload.groupId ? Number(payload.groupId) : null
  };
}

function validateBrandingInput(input) {
  if (!['GLOBAL', 'GROUP', 'USER'].includes(input.scope)) {
    throw new Error('scope must be GLOBAL, GROUP, or USER');
  }
  if (!input.name) {
    throw new Error('name is required');
  }

  if (input.scope === 'GLOBAL') {
    input.userId = null;
    input.groupId = null;
  }

  if (input.scope === 'GROUP') {
    if (!Number.isInteger(input.groupId) || input.groupId < 1) {
      throw new Error('groupId is required for GROUP scope');
    }
    input.userId = null;
  }

  if (input.scope === 'USER') {
    if (!Number.isInteger(input.userId) || input.userId < 1) {
      throw new Error('userId is required for USER scope');
    }
    input.groupId = null;
  }
}

function mergeBranding(base = {}, override = {}) {
  return {
    ...base,
    ...Object.fromEntries(Object.entries(override).filter(([, value]) => value !== null && value !== undefined))
  };
}

class SubscriptionBrandingService {
  async listBrandings() {
    return prisma.subscriptionBranding.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true
          }
        },
        group: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: [
        { scope: 'asc' },
        { priority: 'asc' },
        { id: 'asc' }
      ]
    });
  }

  async createBranding(payload = {}) {
    const input = normalizeBrandingInput(payload);
    validateBrandingInput(input);

    return prisma.subscriptionBranding.create({
      data: input
    });
  }

  async updateBranding(id, payload = {}) {
    const current = await prisma.subscriptionBranding.findUnique({
      where: { id: Number(id) }
    });
    if (!current) {
      throw new Error('Subscription branding not found');
    }

    const input = normalizeBrandingInput({
      ...current,
      ...payload
    });
    validateBrandingInput(input);

    return prisma.subscriptionBranding.update({
      where: { id: Number(id) },
      data: input
    });
  }

  async deleteBranding(id) {
    return prisma.subscriptionBranding.delete({
      where: { id: Number(id) }
    });
  }

  async resolveEffectiveBrandingForUser(userId) {
    if (!env.SUBSCRIPTION_BRANDING_ENABLED) {
      return null;
    }

    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || numericUserId < 1) {
      return null;
    }

    const memberships = await prisma.userGroup.findMany({
      where: { userId: numericUserId },
      select: { groupId: true }
    });
    const groupIds = memberships.map((entry) => entry.groupId);

    const [globalBrandings, groupBrandings, userBranding] = await Promise.all([
      prisma.subscriptionBranding.findMany({
        where: {
          scope: 'GLOBAL',
          enabled: true
        },
        orderBy: [{ priority: 'asc' }, { id: 'asc' }]
      }),
      groupIds.length > 0
        ? prisma.subscriptionBranding.findMany({
            where: {
              scope: 'GROUP',
              groupId: {
                in: groupIds
              },
              enabled: true
            },
            orderBy: [{ priority: 'asc' }, { id: 'asc' }]
          })
        : [],
      prisma.subscriptionBranding.findFirst({
        where: {
          scope: 'USER',
          userId: numericUserId,
          enabled: true
        },
        orderBy: [{ priority: 'asc' }, { id: 'asc' }]
      })
    ]);

    const globalBranding = globalBrandings[0] || null;
    const groupBranding = groupBrandings[0] || null;

    const merged = mergeBranding(
      mergeBranding(
        {
          appName: 'One-UI',
          profileTitle: 'One-UI Subscription',
          profileDescription: 'Generated by One-UI',
          clashProfileName: 'One-UI'
        },
        globalBranding || {}
      ),
      groupBranding || {}
    );

    const finalBranding = mergeBranding(merged, userBranding || {});
    return finalBranding;
  }
}

module.exports = new SubscriptionBrandingService();
