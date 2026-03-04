const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

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

function normalizeMieruQuotas(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const normalized = [];

  for (const entry of entries) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const days = entry.days === undefined || entry.days === null
      ? undefined
      : Number.parseInt(String(entry.days), 10);
    const megabytes = entry.megabytes === undefined || entry.megabytes === null
      ? undefined
      : Number.parseInt(String(entry.megabytes), 10);

    const hasDays = Number.isInteger(days) && days >= 0;
    const hasMegabytes = Number.isInteger(megabytes) && megabytes >= 0;
    if (!hasDays && !hasMegabytes) {
      continue;
    }

    const quota = {};
    if (hasDays) {
      quota.days = days;
    }
    if (hasMegabytes) {
      quota.megabytes = megabytes;
    }
    normalized.push(quota);
  }

  return normalized;
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

    const quotas = normalizeMieruQuotas(entry?.quotas);

    deduped.set(name, {
      name,
      password,
      enabled,
      ...(quotas.length > 0 ? { quotas } : {}),
      createdAt: entry?.createdAt || null,
      updatedAt: entry?.updatedAt || null
    });
  }

  return Array.from(deduped.values());
}

function mergeCustomUsers(customUsers) {
  const merged = new Map();

  for (const user of normalizeManagedCustomUsers(customUsers)) {
    if (!user.enabled) {
      continue;
    }
    merged.set(user.name, {
      name: user.name,
      password: user.password,
      ...(Array.isArray(user.quotas) && user.quotas.length > 0 ? { quotas: normalizeMieruQuotas(user.quotas) } : {})
    });
  }

  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function sanitizeConfigDocument(configDocument) {
  const base = deepCloneObject(configDocument);
  if (isPlainObject(base.oneUiSync)) {
    delete base.oneUiSync;
  }
  return base;
}

function getSyncStateDefaultPath(configPath) {
  return path.join(path.dirname(configPath), 'oneui_sync_state.json');
}

class MieruSyncService {
  constructor() {
    this.enabled = parseBoolean(process.env.MIERU_ENABLED, false);
    this.autoSync = parseBoolean(process.env.MIERU_AUTO_SYNC, false);
    this.configPath = String(process.env.MIERU_CONFIG_PATH || '/opt/one-ui/mieru/server_config.json').trim();
    this.statePath = String(process.env.MIERU_STATE_PATH || getSyncStateDefaultPath(this.configPath)).trim();
    this.usersPathSegments = parsePathSegments(process.env.MIERU_USERS_JSON_PATH, 'users');
    this.restartAfterSync = parseBoolean(process.env.MIERU_SYNC_RESTART, true);
    this.requireRestart = parseBoolean(process.env.MIERU_SYNC_REQUIRE_RESTART, false);
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

  async loadSyncState() {
    try {
      const raw = await fs.readFile(this.statePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        exists: true,
        parsed: isPlainObject(parsed) ? parsed : {},
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

  getSyncMetadata(stateDocument, configDocument) {
    if (isPlainObject(stateDocument) && stateDocument.managedBy) {
      return deepCloneObject(stateDocument);
    }

    if (isPlainObject(stateDocument?.oneUiSync)) {
      return deepCloneObject(stateDocument.oneUiSync);
    }

    if (isPlainObject(configDocument?.oneUiSync)) {
      return deepCloneObject(configDocument.oneUiSync);
    }

    return {};
  }

  buildNextConfig(previousConfig, previousSyncMeta = {}) {
    const base = sanitizeConfigDocument(previousConfig);
    const customUsers = normalizeManagedCustomUsers(previousSyncMeta.customUsers);
    const mergedUsers = mergeCustomUsers(customUsers);
    setObjectValueByPath(base, this.usersPathSegments, mergedUsers);

    const syncMetadata = {
      ...previousSyncMeta,
      managedBy: 'one-ui',
      schemaVersion: 2,
      usersPath: this.usersPathSegments.join('.'),
      panelUserCount: 0,
      customUserCount: customUsers.filter((user) => user.enabled).length,
      userCount: mergedUsers.length,
      usersHash: buildSyncHash(mergedUsers),
      autoSync: this.autoSync,
      customUsers,
      lastSyncedAt: new Date().toISOString()
    };

    return {
      document: base,
      syncMetadata,
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

  async writeStateAtomically(content) {
    const directory = path.dirname(this.statePath);
    await fs.mkdir(directory, { recursive: true });

    const tempPath = `${this.statePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, this.statePath);
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

    const [existingConfig, existingState] = await Promise.all([
      this.loadCurrentConfig(),
      this.loadSyncState()
    ]);

    const previousSyncMeta = this.getSyncMetadata(existingState.parsed, existingConfig.parsed);
    const { document: nextDocument, syncMetadata, hash, userCount } = this.buildNextConfig(
      existingConfig.parsed,
      previousSyncMeta
    );

    const sanitizedCurrent = sanitizeConfigDocument(existingConfig.parsed || {});
    const hadLegacyMetadata = isPlainObject(existingConfig.parsed?.oneUiSync);
    const previousCanonical = stableStringify(sanitizedCurrent);
    const nextCanonical = stableStringify(nextDocument);
    const configChanged = hadLegacyMetadata || previousCanonical !== nextCanonical;
    const previousSyncCanonical = stableStringify(previousSyncMeta);
    const nextSyncCanonical = stableStringify(syncMetadata);
    const stateChanged = previousSyncCanonical !== nextSyncCanonical;

    if (configChanged) {
      await this.writeConfigAtomically(`${JSON.stringify(nextDocument, null, 2)}\n`);
    }
    if (stateChanged || !existingState.exists) {
      await this.writeStateAtomically(`${JSON.stringify(syncMetadata, null, 2)}\n`);
    }

    const restartResult = await this.restartRuntimeIfNeeded(configChanged);

    return {
      enabled: true,
      autoSync: this.autoSync,
      reason: normalizedReason,
      skipped: false,
      skippedReason: null,
      changed: configChanged || stateChanged,
      restarted: restartResult.restarted,
      restartError: restartResult.restartError,
      configPath: this.configPath,
      statePath: this.statePath,
      usersPath: this.usersPathSegments.join('.'),
      userCount,
      hash
    };
  }
}

module.exports = new MieruSyncService();
