const prisma = require('../config/database');
const { randomUUID } = require('node:crypto');
const cron = require('node-cron');
const env = require('../config/env');
const logger = require('../config/logger');
const xrayManager = require('../xray/manager');
const { NotFoundError, ValidationError } = require('../utils/errors');

const BYTES_PER_GB = 1024 * 1024 * 1024;
const GROUP_STATUS_VALUES = ['ACTIVE', 'LIMITED', 'EXPIRED', 'DISABLED'];
const TRAFFIC_RESET_PERIOD_VALUES = ['NEVER', 'DAILY', 'WEEKLY', 'MONTHLY'];
const POLICY_SOURCE_VALUES = ['MANUAL', 'SCHEDULED'];
const POLICY_RUN_STATUS_VALUES = ['SUCCESS', 'FAILED', 'DRY_RUN'];
const STATUS_RANK = {
  ACTIVE: 1,
  LIMITED: 2,
  EXPIRED: 3,
  DISABLED: 4
};
const TRAFFIC_RESET_RANK = {
  DAILY: 1,
  WEEKLY: 2,
  MONTHLY: 3,
  NEVER: 4
};

function parseId(id) {
  const parsed = Number.parseInt(id, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ValidationError('id must be a positive integer');
  }

  return parsed;
}

function parseBoundedInt(value, { min = 1, max = 100, fallback = 1 } = {}) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  if (parsed < min) {
    return min;
  }

  if (parsed > max) {
    return max;
  }

  return parsed;
}

function parseBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeIds(ids, fieldName) {
  if (!Array.isArray(ids)) {
    return [];
  }

  const normalized = Array.from(new Set(
    ids
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0)
  ));

  if (normalized.length !== ids.length) {
    throw new ValidationError(`${fieldName} must contain positive integer IDs`);
  }

  return normalized;
}

function normalizePriority(value, fallback = 100) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(parsed, 9999));
}

function normalizeInboundAssignments(input = []) {
  if (!Array.isArray(input)) {
    return [];
  }

  const assignments = [];
  const seenInboundIds = new Set();

  input.forEach((entry, index) => {
    if (entry === null || entry === undefined) {
      return;
    }

    if (typeof entry === 'number' || typeof entry === 'string') {
      const inboundId = Number.parseInt(entry, 10);
      if (!Number.isInteger(inboundId) || inboundId < 1 || seenInboundIds.has(inboundId)) {
        return;
      }

      seenInboundIds.add(inboundId);
      assignments.push({
        inboundId,
        enabled: true,
        priority: normalizePriority(100 + index)
      });
      return;
    }

    if (typeof entry === 'object') {
      const inboundId = Number.parseInt(
        String(entry.inboundId ?? entry.id ?? entry.value ?? ''),
        10
      );
      if (!Number.isInteger(inboundId) || inboundId < 1 || seenInboundIds.has(inboundId)) {
        return;
      }

      seenInboundIds.add(inboundId);
      assignments.push({
        inboundId,
        enabled: entry.enabled === undefined ? true : Boolean(entry.enabled),
        priority: normalizePriority(entry.priority, 100 + index)
      });
    }
  });

  return assignments;
}

function parseNullableInt(value, fieldName, { min = 0, max = 2_147_483_647 } = {}) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    throw new ValidationError(`${fieldName} must be an integer`);
  }

  if (parsed < min || parsed > max) {
    throw new ValidationError(`${fieldName} must be between ${min} and ${max}`);
  }

  return parsed;
}

function parseNullableDataLimitBytes(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError('dataLimit must be a non-negative number');
  }

  return BigInt(Math.floor(parsed * BYTES_PER_GB));
}

function parseNullableEnum(value, fieldName, allowedValues) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  const normalized = String(value).trim().toUpperCase();
  if (!allowedValues.includes(normalized)) {
    throw new ValidationError(`${fieldName} is invalid`);
  }

  return normalized;
}

function parseNullableString(value, fieldName, { maxLength = 255 } = {}) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length > maxLength) {
    throw new ValidationError(`${fieldName} must be ${maxLength} characters or fewer`);
  }

  return normalized;
}

function selectStrictestStatus(statusValues = []) {
  const filtered = statusValues.filter((value) => value && STATUS_RANK[value]);
  if (filtered.length === 0) {
    return null;
  }

  return filtered.sort((first, second) => STATUS_RANK[second] - STATUS_RANK[first])[0];
}

function selectStrictestResetPeriod(resetValues = []) {
  const filtered = resetValues.filter((value) => value && TRAFFIC_RESET_RANK[value]);
  if (filtered.length === 0) {
    return null;
  }

  return filtered.sort((first, second) => TRAFFIC_RESET_RANK[first] - TRAFFIC_RESET_RANK[second])[0];
}

function pickStrictestIpLimit(ipLimits = []) {
  const numeric = ipLimits
    .map((value) => (value === null || value === undefined ? null : Number.parseInt(String(value), 10)))
    .filter((value) => Number.isInteger(value) && value >= 0);

  if (numeric.length === 0) {
    return null;
  }

  const positive = numeric.filter((value) => value > 0);
  if (positive.length > 0) {
    return Math.min(...positive);
  }

  return 0;
}

function pickMinimumInteger(values = []) {
  const numeric = values
    .map((value) => (value === null || value === undefined ? null : Number.parseInt(String(value), 10)))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (numeric.length === 0) {
    return null;
  }

  return Math.min(...numeric);
}

function pickMinimumBigInt(values = []) {
  const bigints = [];
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }

    try {
      bigints.push(typeof value === 'bigint' ? value : BigInt(value));
    } catch (_error) {
      // Ignore invalid values.
    }
  }

  if (bigints.length === 0) {
    return null;
  }

  return bigints.reduce((acc, value) => (value < acc ? value : acc), bigints[0]);
}

async function reloadXrayIfEnabled(operation) {
  if (!env.XRAY_AUTO_RELOAD) {
    return;
  }

  try {
    await xrayManager.restart();
  } catch (error) {
    logger.warn('Xray auto-reload failed; continuing request', {
      operation,
      message: error.message
    });

    if (env.XRAY_AUTO_RELOAD_STRICT) {
      throw error;
    }
  }
}

class GroupService {
  async assertUsersExist(userIds) {
    if (userIds.length === 0) {
      return;
    }

    const count = await prisma.user.count({
      where: {
        id: { in: userIds }
      }
    });

    if (count !== userIds.length) {
      throw new ValidationError('One or more userIds are invalid');
    }
  }

  async assertInboundsExist(inboundIds) {
    if (inboundIds.length === 0) {
      return;
    }

    const count = await prisma.inbound.count({
      where: {
        id: { in: inboundIds }
      }
    });

    if (count !== inboundIds.length) {
      throw new ValidationError('One or more inboundIds are invalid');
    }
  }

  normalizePolicyPayload(payload = {}) {
    const policy = {};

    const dataLimit = parseNullableDataLimitBytes(payload.dataLimit);
    if (dataLimit !== undefined) {
      policy.dataLimit = dataLimit;
    }

    const expiryDays = parseNullableInt(payload.expiryDays, 'expiryDays', { min: 1, max: 3650 });
    if (expiryDays !== undefined) {
      policy.expiryDays = expiryDays;
    }

    const ipLimit = parseNullableInt(payload.ipLimit, 'ipLimit', { min: 0, max: 1000 });
    if (ipLimit !== undefined) {
      policy.ipLimit = ipLimit;
    }

    const status = parseNullableEnum(payload.status, 'status', GROUP_STATUS_VALUES);
    if (status !== undefined) {
      policy.status = status;
    }

    const trafficResetPeriod = parseNullableEnum(
      payload.trafficResetPeriod,
      'trafficResetPeriod',
      TRAFFIC_RESET_PERIOD_VALUES
    );
    if (trafficResetPeriod !== undefined) {
      policy.trafficResetPeriod = trafficResetPeriod;
    }

    const trafficResetDay = parseNullableInt(payload.trafficResetDay, 'trafficResetDay', { min: 1, max: 31 });
    if (trafficResetDay !== undefined) {
      policy.trafficResetDay = trafficResetDay;
    }

    return policy;
  }

  getPolicyOverrideSummary(group) {
    return {
      dataLimit: group?.dataLimit ?? null,
      expiryDays: group?.expiryDays ?? null,
      ipLimit: group?.ipLimit ?? null,
      status: group?.status ?? null,
      trafficResetPeriod: group?.trafficResetPeriod ?? null,
      trafficResetDay: group?.trafficResetDay ?? null
    };
  }

  hasPolicyOverrides(group) {
    const policy = this.getPolicyOverrideSummary(group);
    return Object.values(policy).some((value) => value !== null && value !== undefined);
  }

  getTemplatePolicyData(template) {
    return {
      dataLimit: template?.dataLimit ?? null,
      expiryDays: template?.expiryDays ?? null,
      ipLimit: template?.ipLimit ?? null,
      status: template?.status ?? null,
      trafficResetPeriod: template?.trafficResetPeriod ?? null,
      trafficResetDay: template?.trafficResetDay ?? null
    };
  }

  buildTemplateInclude() {
    return {
      _count: {
        select: {
          schedules: true,
          rollouts: true
        }
      }
    };
  }

  buildScheduleInclude() {
    return {
      group: {
        select: {
          id: true,
          name: true,
          isDisabled: true
        }
      },
      template: {
        select: {
          id: true,
          name: true
        }
      },
      _count: {
        select: {
          rollouts: true
        }
      }
    };
  }

  buildRolloutInclude() {
    return {
      group: {
        select: {
          id: true,
          name: true
        }
      },
      template: {
        select: {
          id: true,
          name: true
        }
      },
      schedule: {
        select: {
          id: true,
          name: true
        }
      }
    };
  }

  buildGroupInclude() {
    return {
      _count: {
        select: {
          users: true,
          inbounds: true
        }
      },
      users: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              status: true
            }
          }
        },
        orderBy: {
          userId: 'asc'
        }
      },
      inbounds: {
        include: {
          inbound: {
            select: {
              id: true,
              tag: true,
              protocol: true,
              port: true,
              enabled: true
            }
          }
        },
        orderBy: {
          inboundId: 'asc'
        }
      }
    };
  }

  normalizeTemplatePayload(payload = {}) {
    const data = {};

    const name = parseNullableString(payload.name, 'name', { maxLength: 120 });
    if (name !== undefined) {
      data.name = name;
    }

    const description = parseNullableString(payload.description, 'description', { maxLength: 500 });
    if (description !== undefined) {
      data.description = description;
    }

    if (payload.isDefault !== undefined) {
      data.isDefault = parseBooleanFlag(payload.isDefault, false);
    }

    Object.assign(data, this.normalizePolicyPayload(payload));
    return data;
  }

  normalizeSchedulePayload(payload = {}) {
    const data = {};

    const name = parseNullableString(payload.name, 'name', { maxLength: 120 });
    if (name !== undefined) {
      if (!name) {
        throw new ValidationError('name must not be empty');
      }
      data.name = name;
    }

    if (payload.groupId !== undefined) {
      data.groupId = parseId(payload.groupId);
    }

    if (payload.templateId !== undefined) {
      if (payload.templateId === null || payload.templateId === '') {
        data.templateId = null;
      } else {
        data.templateId = parseId(payload.templateId);
      }
    }

    if (payload.cronExpression !== undefined) {
      const cronExpression = String(payload.cronExpression || '').trim();
      if (!cronExpression) {
        throw new ValidationError('cronExpression is required');
      }
      if (!cron.validate(cronExpression)) {
        throw new ValidationError('cronExpression is invalid');
      }
      data.cronExpression = cronExpression;
    }

    if (payload.timezone !== undefined) {
      const timezone = String(payload.timezone || '').trim() || 'UTC';
      data.timezone = timezone;
    }

    if (payload.enabled !== undefined) {
      data.enabled = parseBooleanFlag(payload.enabled, true);
    }

    if (payload.dryRun !== undefined) {
      data.dryRun = parseBooleanFlag(payload.dryRun, false);
    }

    if (payload.targetUserIds !== undefined) {
      data.targetUserIds = normalizeIds(payload.targetUserIds || [], 'targetUserIds');
    }

    return data;
  }

  async listPolicyTemplates({ page = 1, limit = 50, search = '' } = {}) {
    const safePage = parseBoundedInt(page, { min: 1, max: 1_000_000, fallback: 1 });
    const safeLimit = parseBoundedInt(limit, { min: 1, max: 100, fallback: 50 });
    const skip = (safePage - 1) * safeLimit;
    const normalizedSearch = String(search || '').trim();

    const where = normalizedSearch
      ? {
          OR: [
            {
              name: {
                contains: normalizedSearch,
                mode: 'insensitive'
              }
            },
            {
              description: {
                contains: normalizedSearch,
                mode: 'insensitive'
              }
            }
          ]
        }
      : {};

    const [templates, total] = await Promise.all([
      prisma.groupPolicyTemplate.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        include: this.buildTemplateInclude()
      }),
      prisma.groupPolicyTemplate.count({ where })
    ]);

    return {
      templates,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit)
      }
    };
  }

  async getPolicyTemplateById(id) {
    const templateId = parseId(id);
    const template = await prisma.groupPolicyTemplate.findUnique({
      where: { id: templateId },
      include: this.buildTemplateInclude()
    });

    if (!template) {
      throw new NotFoundError('Group policy template not found');
    }

    return template;
  }

  async createPolicyTemplate(payload = {}) {
    const data = this.normalizeTemplatePayload(payload);
    if (!data.name) {
      throw new ValidationError('name is required');
    }

    if (data.isDefault) {
      await prisma.groupPolicyTemplate.updateMany({
        data: {
          isDefault: false
        }
      });
    }

    const created = await prisma.groupPolicyTemplate.create({
      data
    });

    return this.getPolicyTemplateById(created.id);
  }

  async updatePolicyTemplate(id, payload = {}) {
    const templateId = parseId(id);
    const existing = await prisma.groupPolicyTemplate.findUnique({
      where: { id: templateId },
      select: { id: true }
    });

    if (!existing) {
      throw new NotFoundError('Group policy template not found');
    }

    const data = this.normalizeTemplatePayload(payload);
    if (Object.keys(data).length === 0) {
      return this.getPolicyTemplateById(templateId);
    }

    if (data.name === null || data.name === '') {
      throw new ValidationError('name must not be empty');
    }

    if (data.isDefault) {
      await prisma.groupPolicyTemplate.updateMany({
        where: {
          id: {
            not: templateId
          }
        },
        data: {
          isDefault: false
        }
      });
    }

    await prisma.groupPolicyTemplate.update({
      where: { id: templateId },
      data
    });

    return this.getPolicyTemplateById(templateId);
  }

  async deletePolicyTemplate(id) {
    const templateId = parseId(id);
    await prisma.groupPolicyTemplate.delete({
      where: { id: templateId }
    });

    return { id: templateId };
  }

  async applyPolicyTemplateToGroup(groupId, templateId) {
    const parsedGroupId = parseId(groupId);
    const parsedTemplateId = parseId(templateId);

    const [group, template] = await Promise.all([
      prisma.group.findUnique({
        where: { id: parsedGroupId },
        select: { id: true }
      }),
      prisma.groupPolicyTemplate.findUnique({
        where: { id: parsedTemplateId }
      })
    ]);

    if (!group) {
      throw new NotFoundError('Group not found');
    }

    if (!template) {
      throw new NotFoundError('Group policy template not found');
    }

    await prisma.group.update({
      where: { id: parsedGroupId },
      data: this.getTemplatePolicyData(template)
    });

    await reloadXrayIfEnabled('applyPolicyTemplateToGroup');
    return this.getGroupById(parsedGroupId);
  }

  async listPolicySchedules({ page = 1, limit = 50, search = '', groupId, enabled } = {}) {
    const safePage = parseBoundedInt(page, { min: 1, max: 1_000_000, fallback: 1 });
    const safeLimit = parseBoundedInt(limit, { min: 1, max: 100, fallback: 50 });
    const skip = (safePage - 1) * safeLimit;
    const normalizedSearch = String(search || '').trim();

    const where = {};
    if (groupId !== undefined && groupId !== null && groupId !== '') {
      where.groupId = parseId(groupId);
    }
    if (enabled !== undefined && enabled !== null && enabled !== '') {
      where.enabled = parseBooleanFlag(enabled, true);
    }
    if (normalizedSearch) {
      where.OR = [
        {
          name: {
            contains: normalizedSearch,
            mode: 'insensitive'
          }
        },
        {
          group: {
            name: {
              contains: normalizedSearch,
              mode: 'insensitive'
            }
          }
        },
        {
          template: {
            name: {
              contains: normalizedSearch,
              mode: 'insensitive'
            }
          }
        }
      ];
    }

    const [schedules, total] = await Promise.all([
      prisma.groupPolicySchedule.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }],
        include: this.buildScheduleInclude()
      }),
      prisma.groupPolicySchedule.count({ where })
    ]);

    return {
      schedules,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit)
      }
    };
  }

  async getPolicyScheduleById(id) {
    const scheduleId = parseId(id);
    const schedule = await prisma.groupPolicySchedule.findUnique({
      where: { id: scheduleId },
      include: this.buildScheduleInclude()
    });

    if (!schedule) {
      throw new NotFoundError('Group policy schedule not found');
    }

    return schedule;
  }

  async createPolicySchedule(payload = {}) {
    const data = this.normalizeSchedulePayload(payload);
    if (!data.name) {
      throw new ValidationError('name is required');
    }
    if (!data.groupId) {
      throw new ValidationError('groupId is required');
    }
    if (!data.cronExpression) {
      throw new ValidationError('cronExpression is required');
    }

    await Promise.all([
      prisma.group.findUnique({ where: { id: data.groupId }, select: { id: true } }).then((group) => {
        if (!group) {
          throw new ValidationError('groupId is invalid');
        }
      }),
      data.templateId
        ? prisma.groupPolicyTemplate.findUnique({ where: { id: data.templateId }, select: { id: true } }).then((template) => {
            if (!template) {
              throw new ValidationError('templateId is invalid');
            }
          })
        : Promise.resolve(),
      data.targetUserIds && data.targetUserIds.length > 0
        ? this.assertUsersExist(data.targetUserIds)
        : Promise.resolve()
    ]);

    const created = await prisma.groupPolicySchedule.create({
      data
    });

    return this.getPolicyScheduleById(created.id);
  }

  async updatePolicySchedule(id, payload = {}) {
    const scheduleId = parseId(id);
    const existing = await prisma.groupPolicySchedule.findUnique({
      where: { id: scheduleId },
      select: { id: true }
    });

    if (!existing) {
      throw new NotFoundError('Group policy schedule not found');
    }

    const data = this.normalizeSchedulePayload(payload);
    if (Object.keys(data).length === 0) {
      return this.getPolicyScheduleById(scheduleId);
    }

    await Promise.all([
      data.groupId
        ? prisma.group.findUnique({ where: { id: data.groupId }, select: { id: true } }).then((group) => {
            if (!group) {
              throw new ValidationError('groupId is invalid');
            }
          })
        : Promise.resolve(),
      data.templateId
        ? prisma.groupPolicyTemplate.findUnique({ where: { id: data.templateId }, select: { id: true } }).then((template) => {
            if (!template) {
              throw new ValidationError('templateId is invalid');
            }
          })
        : Promise.resolve(),
      data.targetUserIds && data.targetUserIds.length > 0
        ? this.assertUsersExist(data.targetUserIds)
        : Promise.resolve()
    ]);

    await prisma.groupPolicySchedule.update({
      where: { id: scheduleId },
      data
    });

    return this.getPolicyScheduleById(scheduleId);
  }

  async deletePolicySchedule(id) {
    const scheduleId = parseId(id);
    await prisma.groupPolicySchedule.delete({
      where: { id: scheduleId }
    });

    return { id: scheduleId };
  }

  async listPolicyRollouts({ page = 1, limit = 50, groupId, status, source, scheduleId } = {}) {
    const safePage = parseBoundedInt(page, { min: 1, max: 1_000_000, fallback: 1 });
    const safeLimit = parseBoundedInt(limit, { min: 1, max: 200, fallback: 50 });
    const skip = (safePage - 1) * safeLimit;
    const where = {};

    if (groupId !== undefined && groupId !== null && groupId !== '') {
      where.groupId = parseId(groupId);
    }

    if (scheduleId !== undefined && scheduleId !== null && scheduleId !== '') {
      where.scheduleId = parseId(scheduleId);
    }

    if (status !== undefined && status !== null && status !== '') {
      const normalizedStatus = String(status).trim().toUpperCase();
      if (!POLICY_RUN_STATUS_VALUES.includes(normalizedStatus)) {
        throw new ValidationError('status is invalid');
      }
      where.status = normalizedStatus;
    }

    if (source !== undefined && source !== null && source !== '') {
      const normalizedSource = String(source).trim().toUpperCase();
      if (!POLICY_SOURCE_VALUES.includes(normalizedSource)) {
        throw new ValidationError('source is invalid');
      }
      where.source = normalizedSource;
    }

    const [rollouts, total] = await Promise.all([
      prisma.groupPolicyRollout.findMany({
        where,
        skip,
        take: safeLimit,
        include: this.buildRolloutInclude(),
        orderBy: {
          createdAt: 'desc'
        }
      }),
      prisma.groupPolicyRollout.count({ where })
    ]);

    return {
      rollouts,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit)
      }
    };
  }

  async listGroups({ page = 1, limit = 50, search = '', includeDisabled = true } = {}) {
    const safePage = parseBoundedInt(page, { min: 1, max: 1_000_000, fallback: 1 });
    const safeLimit = parseBoundedInt(limit, { min: 1, max: 100, fallback: 50 });
    const safeIncludeDisabled = parseBooleanFlag(includeDisabled, true);
    const skip = (safePage - 1) * safeLimit;

    const where = {};

    if (!safeIncludeDisabled) {
      where.isDisabled = false;
    }

    const normalizedSearch = String(search || '').trim();
    if (normalizedSearch) {
      where.OR = [
        {
          name: {
            contains: normalizedSearch,
            mode: 'insensitive'
          }
        },
        {
          remark: {
            contains: normalizedSearch,
            mode: 'insensitive'
          }
        }
      ];
    }

    const [groups, total] = await Promise.all([
      prisma.group.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: {
          createdAt: 'desc'
        },
        include: this.buildGroupInclude()
      }),
      prisma.group.count({ where })
    ]);

    return {
      groups,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit)
      }
    };
  }

  async getGroupById(id) {
    const groupId = parseId(id);
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: this.buildGroupInclude()
    });

    if (!group) {
      throw new NotFoundError('Group not found');
    }

    return group;
  }

  async createGroup(payload = {}) {
    const name = String(payload.name || '').trim();
    if (!name) {
      throw new ValidationError('name is required');
    }

    const remark = payload.remark === undefined ? undefined : String(payload.remark || '').trim();
    const isDisabled = parseBooleanFlag(payload.isDisabled, false);
    const policyData = this.normalizePolicyPayload(payload);
    const userIds = normalizeIds(payload.userIds || [], 'userIds');
    const inboundIds = normalizeIds(payload.inboundIds || [], 'inboundIds');

    await Promise.all([
      this.assertUsersExist(userIds),
      this.assertInboundsExist(inboundIds)
    ]);

    const group = await prisma.group.create({
      data: {
        name,
        remark,
        isDisabled,
        ...policyData,
        users: {
          create: userIds.map((userId) => ({ userId }))
        },
        inbounds: {
          create: inboundIds.map((inboundId) => ({
            inboundId,
            enabled: true
          }))
        }
      }
    });

    await reloadXrayIfEnabled('createGroup');
    return this.getGroupById(group.id);
  }

  async updateGroup(id, payload = {}) {
    const groupId = parseId(id);

    const existing = await prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true }
    });

    if (!existing) {
      throw new NotFoundError('Group not found');
    }

    const data = {};

    if (payload.name !== undefined) {
      const name = String(payload.name || '').trim();
      if (!name) {
        throw new ValidationError('name must not be empty');
      }
      data.name = name;
    }

    if (payload.remark !== undefined) {
      const remark = String(payload.remark || '').trim();
      data.remark = remark || null;
    }

    if (payload.isDisabled !== undefined) {
      data.isDisabled = parseBooleanFlag(payload.isDisabled, false);
    }

    Object.assign(data, this.normalizePolicyPayload(payload));

    const userIds = payload.userIds !== undefined ? normalizeIds(payload.userIds || [], 'userIds') : null;
    const inboundIds = payload.inboundIds !== undefined ? normalizeIds(payload.inboundIds || [], 'inboundIds') : null;

    await Promise.all([
      userIds ? this.assertUsersExist(userIds) : Promise.resolve(),
      inboundIds ? this.assertInboundsExist(inboundIds) : Promise.resolve()
    ]);

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.group.update({
          where: { id: groupId },
          data
        });
      }

      if (userIds) {
        await tx.userGroup.deleteMany({
          where: { groupId }
        });

        if (userIds.length > 0) {
          await tx.userGroup.createMany({
            data: userIds.map((userId) => ({ groupId, userId })),
            skipDuplicates: true
          });
        }
      }

      if (inboundIds) {
        await tx.groupInbound.deleteMany({
          where: { groupId }
        });

        if (inboundIds.length > 0) {
          await tx.groupInbound.createMany({
            data: inboundIds.map((inboundId) => ({
              groupId,
              inboundId,
              enabled: true
            })),
            skipDuplicates: true
          });
        }
      }
    });

    await reloadXrayIfEnabled('updateGroup');
    return this.getGroupById(groupId);
  }

  async deleteGroup(id) {
    const groupId = parseId(id);

    await prisma.group.delete({
      where: { id: groupId }
    });

    await reloadXrayIfEnabled('deleteGroup');
    return { id: groupId };
  }

  async addUsers(groupId, userIds) {
    const parsedGroupId = parseId(groupId);
    const normalizedUserIds = normalizeIds(userIds || [], 'userIds');

    if (normalizedUserIds.length === 0) {
      throw new ValidationError('userIds must be a non-empty array');
    }

    await this.assertUsersExist(normalizedUserIds);

    await prisma.userGroup.createMany({
      data: normalizedUserIds.map((userId) => ({
        groupId: parsedGroupId,
        userId
      })),
      skipDuplicates: true
    });

    await reloadXrayIfEnabled('addUsersToGroup');
    return this.getGroupById(parsedGroupId);
  }

  async removeUsers(groupId, userIds) {
    const parsedGroupId = parseId(groupId);
    const normalizedUserIds = normalizeIds(userIds || [], 'userIds');

    if (normalizedUserIds.length === 0) {
      throw new ValidationError('userIds must be a non-empty array');
    }

    await prisma.userGroup.deleteMany({
      where: {
        groupId: parsedGroupId,
        userId: {
          in: normalizedUserIds
        }
      }
    });

    await reloadXrayIfEnabled('removeUsersFromGroup');
    return this.getGroupById(parsedGroupId);
  }

  async setInbounds(groupId, inboundIds) {
    const parsedGroupId = parseId(groupId);
    const inboundAssignments = normalizeInboundAssignments(inboundIds || []);
    const normalizedInboundIds = inboundAssignments.map((assignment) => assignment.inboundId);

    await this.assertInboundsExist(normalizedInboundIds);

    await prisma.$transaction(async (tx) => {
      await tx.groupInbound.deleteMany({
        where: { groupId: parsedGroupId }
      });

      if (normalizedInboundIds.length > 0) {
        await tx.groupInbound.createMany({
          data: inboundAssignments.map((assignment) => ({
            groupId: parsedGroupId,
            inboundId: assignment.inboundId,
            enabled: assignment.enabled,
            priority: assignment.priority
          })),
          skipDuplicates: true
        });
      }
    });

    await reloadXrayIfEnabled('setGroupInbounds');
    return this.getGroupById(parsedGroupId);
  }

  async moveUsers(groupId, userIds) {
    const parsedGroupId = parseId(groupId);
    const normalizedUserIds = normalizeIds(userIds || [], 'userIds');

    if (normalizedUserIds.length === 0) {
      throw new ValidationError('userIds must be a non-empty array');
    }

    await this.assertUsersExist(normalizedUserIds);

    const group = await prisma.group.findUnique({
      where: { id: parsedGroupId },
      select: { id: true }
    });

    if (!group) {
      throw new NotFoundError('Group not found');
    }

    await prisma.$transaction(async (tx) => {
      await tx.userGroup.deleteMany({
        where: {
          userId: {
            in: normalizedUserIds
          }
        }
      });

      await tx.userGroup.createMany({
        data: normalizedUserIds.map((userId) => ({
          groupId: parsedGroupId,
          userId
        })),
        skipDuplicates: true
      });
    });

    await reloadXrayIfEnabled('moveUsersToGroup');
    return this.getGroupById(parsedGroupId);
  }

  buildInheritedPolicy(groups = []) {
    const dataLimit = pickMinimumBigInt(groups.map((group) => group.dataLimit));
    const expiryDays = pickMinimumInteger(groups.map((group) => group.expiryDays));
    const ipLimit = pickStrictestIpLimit(groups.map((group) => group.ipLimit));
    const status = selectStrictestStatus(groups.map((group) => group.status));
    const trafficResetPeriod = selectStrictestResetPeriod(groups.map((group) => group.trafficResetPeriod));

    let trafficResetDay = null;
    if (trafficResetPeriod) {
      const periodScopedDays = groups
        .filter((group) => group.trafficResetPeriod === trafficResetPeriod)
        .map((group) => group.trafficResetDay);
      trafficResetDay = pickMinimumInteger(periodScopedDays);
    }

    if (trafficResetDay === null) {
      trafficResetDay = pickMinimumInteger(groups.map((group) => group.trafficResetDay));
    }

    return {
      dataLimit,
      expiryDays,
      ipLimit,
      status,
      trafficResetPeriod,
      trafficResetDay
    };
  }

  async getUserEffectivePolicy(userId) {
    const parsedUserId = parseId(userId);

    const user = await prisma.user.findUnique({
      where: { id: parsedUserId },
      select: {
        id: true,
        email: true,
        dataLimit: true,
        expireDate: true,
        ipLimit: true,
        status: true,
        trafficResetPeriod: true,
        trafficResetDay: true,
        groups: {
          where: {
            group: {
              isDisabled: false
            }
          },
          include: {
            group: {
              select: {
                id: true,
                name: true,
                isDisabled: true,
                dataLimit: true,
                expiryDays: true,
                ipLimit: true,
                status: true,
                trafficResetPeriod: true,
                trafficResetDay: true
              }
            }
          }
        }
      }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const activeGroups = user.groups
      .map((relation) => relation.group)
      .filter(Boolean)
      .filter((group) => !group.isDisabled);
    const inherited = this.buildInheritedPolicy(activeGroups);

    const recommendedExpireDate = inherited.expiryDays !== null
      ? (() => {
          const next = new Date();
          next.setDate(next.getDate() + inherited.expiryDays);
          return next;
        })()
      : null;

    const effectivePolicy = {
      dataLimit: inherited.dataLimit !== null ? inherited.dataLimit : user.dataLimit,
      expireDate: recommendedExpireDate || user.expireDate,
      ipLimit: inherited.ipLimit !== null ? inherited.ipLimit : user.ipLimit,
      status: inherited.status !== null ? inherited.status : user.status,
      trafficResetPeriod:
        inherited.trafficResetPeriod !== null ? inherited.trafficResetPeriod : user.trafficResetPeriod,
      trafficResetDay: inherited.trafficResetDay !== null ? inherited.trafficResetDay : user.trafficResetDay
    };

    const drift = {
      dataLimit: inherited.dataLimit !== null && inherited.dataLimit !== user.dataLimit,
      expireDate:
        recommendedExpireDate !== null && Math.abs(recommendedExpireDate.getTime() - user.expireDate.getTime()) > 60_000,
      ipLimit: inherited.ipLimit !== null && inherited.ipLimit !== user.ipLimit,
      status: inherited.status !== null && inherited.status !== user.status,
      trafficResetPeriod:
        inherited.trafficResetPeriod !== null && inherited.trafficResetPeriod !== user.trafficResetPeriod,
      trafficResetDay: inherited.trafficResetDay !== null && inherited.trafficResetDay !== user.trafficResetDay
    };

    return {
      user: {
        id: user.id,
        email: user.email
      },
      directPolicy: {
        dataLimit: user.dataLimit,
        expireDate: user.expireDate,
        ipLimit: user.ipLimit,
        status: user.status,
        trafficResetPeriod: user.trafficResetPeriod,
        trafficResetDay: user.trafficResetDay
      },
      inheritedPolicy: {
        ...inherited,
        expireDate: recommendedExpireDate
      },
      effectivePolicy,
      drift,
      groups: activeGroups.map((group) => ({
        id: group.id,
        name: group.name,
        policy: this.getPolicyOverrideSummary(group)
      }))
    };
  }

  async applyGroupPolicy(
    groupId,
    {
      userIds = [],
      dryRun = false,
      initiatedBy = null,
      source = 'MANUAL',
      scheduleId = null,
      templateId = null,
      recordRollout = true
    } = {}
  ) {
    const parsedGroupId = parseId(groupId);
    const normalizedUserIds = normalizeIds(userIds || [], 'userIds');
    const dryRunMode = parseBooleanFlag(dryRun, false);
    const normalizedSource = String(source || 'MANUAL').trim().toUpperCase();
    if (!POLICY_SOURCE_VALUES.includes(normalizedSource)) {
      throw new ValidationError('source is invalid');
    }

    const normalizedScheduleId = scheduleId === null || scheduleId === undefined ? null : parseId(scheduleId);
    const normalizedTemplateId = templateId === null || templateId === undefined ? null : parseId(templateId);
    const normalizedInitiatedBy = parseNullableString(initiatedBy, 'initiatedBy', { maxLength: 120 });

    const group = await prisma.group.findUnique({
      where: { id: parsedGroupId },
      include: {
        users: {
          select: {
            userId: true
          }
        }
      }
    });

    if (!group) {
      throw new NotFoundError('Group not found');
    }

    if (!this.hasPolicyOverrides(group)) {
      throw new ValidationError('Group has no policy overrides to apply');
    }

    const memberUserIds = group.users.map((relation) => relation.userId);

    const targetUserIds = normalizedUserIds.length > 0 ? normalizedUserIds : memberUserIds;
    if (targetUserIds.length === 0) {
      throw new ValidationError('No target users available for policy apply');
    }

    if (normalizedUserIds.length > 0) {
      const memberSet = new Set(memberUserIds);
      const outsider = normalizedUserIds.find((userId) => !memberSet.has(userId));
      if (outsider) {
        throw new ValidationError(`userId ${outsider} is not a member of this group`);
      }
    }

    const users = await prisma.user.findMany({
      where: {
        id: {
          in: targetUserIds
        }
      },
      select: {
        id: true,
        email: true,
        dataLimit: true,
        expireDate: true,
        ipLimit: true,
        status: true,
        trafficResetPeriod: true,
        trafficResetDay: true
      }
    });

    if (users.length !== targetUserIds.length) {
      throw new ValidationError('One or more target user IDs are invalid');
    }

    const now = new Date();
    const plans = [];

    for (const user of users) {
      const nextData = {};
      const changes = {};

      if (group.dataLimit !== null && group.dataLimit !== undefined && group.dataLimit !== user.dataLimit) {
        nextData.dataLimit = group.dataLimit;
        changes.dataLimit = {
          from: user.dataLimit,
          to: group.dataLimit
        };
      }

      if (group.expiryDays !== null && group.expiryDays !== undefined) {
        const nextExpireDate = new Date(now);
        nextExpireDate.setDate(nextExpireDate.getDate() + group.expiryDays);
        if (Math.abs(nextExpireDate.getTime() - user.expireDate.getTime()) > 60_000) {
          nextData.expireDate = nextExpireDate;
          changes.expireDate = {
            from: user.expireDate,
            to: nextExpireDate
          };
        }
      }

      if (group.ipLimit !== null && group.ipLimit !== undefined && group.ipLimit !== user.ipLimit) {
        nextData.ipLimit = group.ipLimit;
        changes.ipLimit = {
          from: user.ipLimit,
          to: group.ipLimit
        };
      }

      if (group.status !== null && group.status !== undefined && group.status !== user.status) {
        nextData.status = group.status;
        changes.status = {
          from: user.status,
          to: group.status
        };
      }

      if (
        group.trafficResetPeriod !== null
        && group.trafficResetPeriod !== undefined
        && group.trafficResetPeriod !== user.trafficResetPeriod
      ) {
        nextData.trafficResetPeriod = group.trafficResetPeriod;
        changes.trafficResetPeriod = {
          from: user.trafficResetPeriod,
          to: group.trafficResetPeriod
        };
      }

      if (
        group.trafficResetDay !== null
        && group.trafficResetDay !== undefined
        && group.trafficResetDay !== user.trafficResetDay
      ) {
        nextData.trafficResetDay = group.trafficResetDay;
        changes.trafficResetDay = {
          from: user.trafficResetDay,
          to: group.trafficResetDay
        };
      }

      if (Object.keys(changes).length === 0) {
        continue;
      }

      plans.push({
        userId: user.id,
        email: user.email,
        nextData,
        changes
      });
    }

    const summary = {
      targetUsers: targetUserIds.length,
      wouldUpdateUsers: plans.length,
      skippedUsers: targetUserIds.length - plans.length
    };

    const preview = plans.slice(0, 25).map((plan) => ({
      userId: plan.userId,
      email: plan.email,
      changes: plan.changes
    }));

    if (dryRunMode) {
      const dryRunResult = {
        dryRun: true,
        group: {
          id: group.id,
          name: group.name
        },
        summary,
        preview,
        previewTruncated: plans.length > preview.length
      };

      if (recordRollout) {
        await prisma.groupPolicyRollout.create({
          data: {
            groupId: group.id,
            templateId: normalizedTemplateId,
            scheduleId: normalizedScheduleId,
            source: normalizedSource,
            status: 'DRY_RUN',
            dryRun: true,
            initiatedBy: normalizedInitiatedBy,
            summary: dryRunResult
          }
        });
      }

      return dryRunResult;
    }

    if (plans.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const plan of plans) {
          await tx.user.update({
            where: { id: plan.userId },
            data: plan.nextData
          });
        }
      });
    }

    const operationId = randomUUID();
    const auditLog = await prisma.systemLog.create({
      data: {
        level: 'INFO',
        message: 'GROUP_POLICY_APPLIED',
        metadata: {
          operationId,
          groupId: group.id,
          groupName: group.name,
          summary,
          source: normalizedSource,
          scheduleId: normalizedScheduleId,
          templateId: normalizedTemplateId,
          users: plans.map((plan) => ({
            userId: plan.userId,
            email: plan.email,
            changes: plan.changes
          })),
          rollbackHint: 'Use metadata snapshot to manually revert user fields if required.'
        }
      }
    });

    await reloadXrayIfEnabled('applyGroupPolicy');

    const successResult = {
      dryRun: false,
      group: {
        id: group.id,
        name: group.name
      },
      summary,
      audit: {
        logId: auditLog.id,
        operationId
      }
    };

    if (recordRollout) {
      await prisma.groupPolicyRollout.create({
        data: {
          groupId: group.id,
          templateId: normalizedTemplateId,
          scheduleId: normalizedScheduleId,
          source: normalizedSource,
          status: 'SUCCESS',
          dryRun: false,
          initiatedBy: normalizedInitiatedBy,
          summary: successResult
        }
      });
    }

    return successResult;
  }

  async runPolicySchedule(
    scheduleId,
    { initiatedBy = 'scheduler', source = 'SCHEDULED' } = {}
  ) {
    const parsedScheduleId = parseId(scheduleId);
    const normalizedSource = String(source || 'SCHEDULED').trim().toUpperCase();
    if (!POLICY_SOURCE_VALUES.includes(normalizedSource)) {
      throw new ValidationError('source is invalid');
    }
    const schedule = await prisma.groupPolicySchedule.findUnique({
      where: { id: parsedScheduleId },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            isDisabled: true
          }
        },
        template: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!schedule) {
      throw new NotFoundError('Group policy schedule not found');
    }

    if (!schedule.enabled) {
      throw new ValidationError('Group policy schedule is disabled');
    }

    if (!schedule.group || schedule.group.isDisabled) {
      throw new ValidationError('Target group is unavailable or disabled');
    }

    try {
      if (schedule.templateId) {
        await this.applyPolicyTemplateToGroup(schedule.groupId, schedule.templateId);
      }

      const result = await this.applyGroupPolicy(schedule.groupId, {
        userIds: schedule.targetUserIds || [],
        dryRun: schedule.dryRun,
        initiatedBy,
        source: normalizedSource,
        scheduleId: schedule.id,
        templateId: schedule.templateId,
        recordRollout: true
      });

      await prisma.groupPolicySchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: new Date(),
          runCount: {
            increment: 1
          },
          lastStatus: result.dryRun ? 'DRY_RUN' : 'SUCCESS',
          lastError: null
        }
      });

      return {
        schedule: {
          id: schedule.id,
          name: schedule.name,
          groupId: schedule.groupId,
          templateId: schedule.templateId
        },
        result
      };
    } catch (error) {
      await prisma.groupPolicyRollout.create({
        data: {
          groupId: schedule.groupId,
          templateId: schedule.templateId,
          scheduleId: schedule.id,
          source: normalizedSource,
          status: 'FAILED',
          dryRun: schedule.dryRun,
          initiatedBy: parseNullableString(initiatedBy, 'initiatedBy', { maxLength: 120 }),
          errorMessage: error.message,
          summary: {
            scheduleId: schedule.id,
            scheduleName: schedule.name
          }
        }
      });

      await prisma.groupPolicySchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: new Date(),
          runCount: {
            increment: 1
          },
          lastStatus: 'FAILED',
          lastError: error.message
        }
      });

      throw error;
    }
  }

  async getUserEffectiveInbounds(userId) {
    const parsedUserId = parseId(userId);

    const user = await prisma.user.findUnique({
      where: { id: parsedUserId },
      select: {
        id: true,
        email: true,
        status: true,
        inbounds: {
          where: {
            enabled: true,
            inbound: {
              enabled: true
            }
          },
          include: {
            inbound: true
          }
        },
        groups: {
          where: {
            group: {
              isDisabled: false
            }
          },
          include: {
            group: {
              include: {
                inbounds: {
                  where: {
                    enabled: true,
                    inbound: {
                      enabled: true
                    }
                  },
                  include: {
                    inbound: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const effectiveMap = new Map();
    const directInbounds = [];
    const groupInbounds = [];

    for (const relation of user.inbounds) {
      if (!relation.inbound) {
        continue;
      }

      const directItem = {
        inboundId: relation.inboundId,
        priority: relation.priority,
        inbound: relation.inbound
      };
      directInbounds.push(directItem);

      effectiveMap.set(relation.inboundId, {
        inboundId: relation.inboundId,
        priority: relation.priority,
        inbound: relation.inbound,
        sources: [{ type: 'DIRECT' }]
      });
    }

    for (const userGroup of user.groups) {
      const group = userGroup.group;
      if (!group || group.isDisabled) {
        continue;
      }

      for (const relation of group.inbounds) {
        if (!relation.inbound) {
          continue;
        }

        groupInbounds.push({
          groupId: group.id,
          groupName: group.name,
          inboundId: relation.inboundId,
          priority: relation.priority,
          inbound: relation.inbound
        });

        const existing = effectiveMap.get(relation.inboundId);
        if (!existing) {
          effectiveMap.set(relation.inboundId, {
            inboundId: relation.inboundId,
            priority: relation.priority,
            inbound: relation.inbound,
            sources: []
          });
        } else if (relation.priority < existing.priority) {
          existing.priority = relation.priority;
        }

        const target = effectiveMap.get(relation.inboundId);
        target.sources.push({
          type: 'GROUP',
          groupId: group.id,
          groupName: group.name
        });
      }
    }

    const securityRank = (security) => {
      if (security === 'REALITY') return 0;
      if (security === 'TLS') return 1;
      return 2;
    };

    const effectiveInbounds = Array.from(effectiveMap.values()).sort((a, b) => {
      const priorityDelta = Number(a.priority || 100) - Number(b.priority || 100);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const securityDelta = securityRank(a.inbound?.security) - securityRank(b.inbound?.security);
      if (securityDelta !== 0) {
        return securityDelta;
      }

      const aPort = Number(a.inbound?.port || 0);
      const bPort = Number(b.inbound?.port || 0);
      if (aPort !== bPort) {
        return aPort - bPort;
      }

      return Number(a.inboundId) - Number(b.inboundId);
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        status: user.status
      },
      groups: user.groups
        .map((relation) => relation.group)
        .filter(Boolean)
        .map((group) => ({
          id: group.id,
          name: group.name,
          isDisabled: group.isDisabled
        })),
      directInbounds,
      groupInbounds,
      effectiveInbounds
    };
  }
}

module.exports = new GroupService();
