const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const prisma = require('../config/database');
const logger = require('../config/logger');
const mieruRuntimeService = require('./mieruRuntime.service');

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'y'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'n'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parsePositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function parsePathSegments(value, fallback = 'users') {
  const source = String(value || fallback)
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);

  return source.length > 0 ? source : ['users'];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepCloneObject(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) {
    return {};
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return {};
  }
}

function stableSortObject(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSortObject(entry));
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .reduce((accumulator, key) => {
        accumulator[key] = stableSortObject(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableSortObject(value));
}

function setObjectValueByPath(target, segments, nextValue) {
  const safeSegments = Array.isArray(segments) && segments.length > 0 ? segments : ['users'];
  let cursor = target;

  for (let index = 0; index < safeSegments.length - 1; index += 1) {
    const segment = safeSegments[index];
    if (!isPlainObject(cursor[segment])) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }

  cursor[safeSegments[safeSegments.length - 1]] = nextValue;
}

function buildSyncHash(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function normalizeMieruCredentialEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const deduped = new Map();

  for (const entry of entries) {
    const name = String(entry?.name || entry?.username || '').trim();
    const password = String(entry?.password || '').trim();

    if (!name || !password) {
      continue;
    }

    deduped.set(name, { name, password });
  }

  return Array.from(deduped.values());
}

function normalizeManagedCustomUsers(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const deduped = new Map();

  for (const entry of entries) {
    const name = String(entry?.name || entry?.username || '').trim();
    const password = String(entry?.password || '').trim();
    const enabled = entry?.enabled === undefined ? true : Boolean(entry.enabled);

    if (!name || !password) {
      continue;
    }

    deduped.set(name, {
      name,
      password,
      enabled,
      createdAt: entry?.createdAt || null,
      updatedAt: entry?.updatedAt || null
    });
  }

  return Array.from(deduped.values());
}

function mergePanelAndCustomUsers(panelUsers, customUsers) {
  const merged = new Map();

  for (const user of normalizeMieruCredentialEntries(panelUsers)) {
    merged.set(user.name, user);
  }

  for (const user of normalizeManagedCustomUsers(customUsers)) {
    if (!user.enabled) {
      continue;
    }
    merged.set(user.name, {
      name: user.name,
      password: user.password
    });
  }

  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

class MieruSyncService {
  constructor() {
    this.enabled = parseBoolean(process.env.MIERU_ENABLED, false);
    this.autoSync = parseBoolean(process.env.MIERU_AUTO_SYNC, true);
    this.configPath = String(process.env.MIERU_CONFIG_PATH || '/opt/one-ui/mieru/server_config.json').trim();
    this.usersPathSegments = parsePathSegments(process.env.MIERU_USERS_JSON_PATH, 'users');
    this.restartAfterSync = parseBoolean(process.env.MIERU_SYNC_RESTART, true);
    this.requireRestart = parseBoolean(process.env.MIERU_SYNC_REQUIRE_RESTART, false);
    this.maxUsers = parsePositiveInt(process.env.MIERU_SYNC_MAX_USERS, 50000, 1, 200000);
    this.includeNonActiveUsers = parseBoolean(process.env.MIERU_SYNC_INCLUDE_NON_ACTIVE_USERS, false);
  }

  async loadCurrentConfig() {
    try {
      const raw = await fs.readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed)) {
        return {
          exists: true,
          parsed: {},
          raw
        };
      }

      return {
        exists: true,
        parsed,
        raw
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
          exists: false,
          parsed: {},
          raw: ''
        };
      }

      throw error;
    }
  }

  async fetchUsers() {
    const where = this.includeNonActiveUsers
      ? {}
      : {
          status: 'ACTIVE',
          OR: [
            { startOnFirstUse: true },
            { expireDate: { gt: new Date() } }
          ]
        };

    const users = await prisma.user.findMany({
      where,
      orderBy: {
        id: 'asc'
      },
      take: this.maxUsers,
      select: {
        email: true,
        password: true
      }
    });

    return users;
  }

  buildMieruUsers(users) {
    return normalizeMieruCredentialEntries(users.map((user) => ({
      name: user.email,
      password: user.password
    })));
  }

  buildNextConfig(previousConfig, mieruUsers) {
    const base = deepCloneObject(previousConfig);
    const previousSyncMeta = isPlainObject(base.oneUiSync) ? deepCloneObject(base.oneUiSync) : {};
    const customUsers = normalizeManagedCustomUsers(previousSyncMeta.customUsers);
    const mergedUsers = mergePanelAndCustomUsers(mieruUsers, customUsers);
    setObjectValueByPath(base, this.usersPathSegments, mergedUsers);

    const syncMetadata = {
      ...previousSyncMeta,
      managedBy: 'one-ui',
      schemaVersion: 2,
      usersPath: this.usersPathSegments.join('.'),
      panelUserCount: mieruUsers.length,
      customUserCount: customUsers.filter((user) => user.enabled).length,
      userCount: mergedUsers.length,
      usersHash: buildSyncHash(mergedUsers),
      autoSync: this.autoSync,
      customUsers,
      lastSyncedAt: new Date().toISOString()
    };

    base.oneUiSync = syncMetadata;

    return {
      document: base,
      hash: syncMetadata.usersHash,
      userCount: mergedUsers.length
    };
  }

  async writeConfigAtomically(content) {
    const directory = path.dirname(this.configPath);
    await fs.mkdir(directory, { recursive: true });

    const tempPath = `${this.configPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, this.configPath);
  }

  async restartRuntimeIfNeeded(changed) {
    if (!changed || !this.restartAfterSync) {
      return {
        restarted: false,
        restartError: null
      };
    }

    try {
      await mieruRuntimeService.restart();
      return {
        restarted: true,
        restartError: null
      };
    } catch (error) {
      const message = String(error?.message || 'Failed to restart Mieru after sync');
      if (this.requireRestart) {
        throw error;
      }

      logger.warn('Mieru restart failed after config sync', {
        action: 'mieru_sync_restart',
        message
      });

      return {
        restarted: false,
        restartError: message
      };
    }
  }

  async syncUsers({
    reason = 'manual',
    force = false
  } = {}) {
    const normalizedReason = String(reason || 'manual').slice(0, 120);

    if (!this.enabled) {
      return {
        enabled: false,
        autoSync: this.autoSync,
        reason: normalizedReason,
        skipped: true,
        skippedReason: 'MIERU_ENABLED=false',
        changed: false,
        restarted: false,
        restartError: null,
        configPath: this.configPath,
        usersPath: this.usersPathSegments.join('.'),
        userCount: 0,
        hash: null
      };
    }

    if (!force && !this.autoSync) {
      return {
        enabled: true,
        autoSync: false,
        reason: normalizedReason,
        skipped: true,
        skippedReason: 'MIERU_AUTO_SYNC=false',
        changed: false,
        restarted: false,
        restartError: null,
        configPath: this.configPath,
        usersPath: this.usersPathSegments.join('.'),
        userCount: 0,
        hash: null
      };
    }

    const [existingConfig, users] = await Promise.all([
      this.loadCurrentConfig(),
      this.fetchUsers()
    ]);

    const mieruUsers = this.buildMieruUsers(users);
    const { document: nextDocument, hash, userCount } = this.buildNextConfig(existingConfig.parsed, mieruUsers);

    const previousCanonical = stableStringify(existingConfig.parsed || {});
    const nextCanonical = stableStringify(nextDocument);
    const changed = previousCanonical !== nextCanonical;

    if (changed) {
      await this.writeConfigAtomically(`${JSON.stringify(nextDocument, null, 2)}\n`);
    }

    const restartResult = await this.restartRuntimeIfNeeded(changed);

    return {
      enabled: true,
      autoSync: this.autoSync,
      reason: normalizedReason,
      skipped: false,
      skippedReason: null,
      changed,
      restarted: restartResult.restarted,
      restartError: restartResult.restartError,
      configPath: this.configPath,
      usersPath: this.usersPathSegments.join('.'),
      userCount,
      hash
    };
  }
}

module.exports = new MieruSyncService();
