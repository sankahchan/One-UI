const fs = require('fs/promises');
const path = require('path');
const yaml = require('js-yaml');

const prisma = require('../config/database');
const logger = require('../config/logger');
const mieruRuntimeService = require('./mieruRuntime.service');
const mieruSyncService = require('./mieruSync.service');
const { ConflictError, NotFoundError, ValidationError } = require('../utils/errors');

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

function getObjectValueByPath(target, segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return undefined;
  }

  let cursor = target;
  for (const segment of segments) {
    if (!isPlainObject(cursor) && !Array.isArray(cursor)) {
      return undefined;
    }
    cursor = cursor?.[segment];
    if (cursor === undefined) {
      return undefined;
    }
  }

  return cursor;
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

function normalizeUsername(value) {
  const username = String(value || '').trim();
  if (!username) {
    throw new ValidationError('username is required');
  }

  if (username.length < 3 || username.length > 96) {
    throw new ValidationError('username must be between 3 and 96 characters');
  }

  if (!/^[A-Za-z0-9._@-]+$/.test(username)) {
    throw new ValidationError('username may only contain letters, numbers, dot, underscore, @, and dash');
  }

  return username;
}

function normalizePassword(value) {
  const password = String(value || '').trim();
  if (!password) {
    throw new ValidationError('password is required');
  }

  if (password.length < 4 || password.length > 256) {
    throw new ValidationError('password must be between 4 and 256 characters');
  }

  return password;
}

function normalizeCustomUsers(entries) {
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

  return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeConfiguredUsers(entries) {
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

    deduped.set(name, {
      name,
      password
    });
  }

  return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeTransport(value, fallback = 'TCP') {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (normalized === 'UDP') {
    return 'UDP';
  }
  return 'TCP';
}

function normalizePortRange(value) {
  const text = String(value || '').trim();
  if (!text) {
    throw new ValidationError('portRange is required');
  }

  const match = text.match(/^(\d{1,5})\s*-\s*(\d{1,5})$/);
  if (!match) {
    throw new ValidationError('portRange must be in "start-end" format, e.g. 2012-2022');
  }

  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2], 10);

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 65535 || start > end) {
    throw new ValidationError('portRange must be between 1-65535 and start must be <= end');
  }

  return `${start}-${end}`;
}

function normalizeMultiplexing(value, fallback = 'MULTIPLEXING_HIGH') {
  const normalized = String(value || fallback).trim().toUpperCase();
  const allowed = new Set([
    'MULTIPLEXING_DEFAULT',
    'MULTIPLEXING_LOW',
    'MULTIPLEXING_MIDDLE',
    'MULTIPLEXING_HIGH'
  ]);

  return allowed.has(normalized) ? normalized : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
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

function sanitizeMultiline(text, maxLength = 1000) {
  if (!text) {
    return '';
  }

  return String(text).replace(/\s+$/g, '').slice(0, maxLength);
}

function escapeShellArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

class MieruManagerService {
  constructor() {
    this.configPath = String(process.env.MIERU_CONFIG_PATH || '/opt/one-ui/mieru/server_config.json').trim();
    this.usersPathSegments = parsePathSegments(process.env.MIERU_USERS_JSON_PATH, 'users');
  }

  async loadCurrentConfig() {
    try {
      const raw = await fs.readFile(this.configPath, 'utf8');
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

  async writeConfigAtomically(content) {
    const directory = path.dirname(this.configPath);
    await fs.mkdir(directory, { recursive: true });

    const tempPath = `${this.configPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, this.configPath);
  }

  getDefaultProfile() {
    const configuredHost = String(process.env.MIERU_PUBLIC_HOST || process.env.PUBLIC_HOST || '').trim();

    return {
      server: configuredHost,
      portRange: String(process.env.MIERU_PORT_RANGE || '2012-2022').trim(),
      transport: normalizeTransport(process.env.MIERU_TRANSPORT, 'TCP'),
      udp: parseBoolean(process.env.MIERU_UDP, true),
      multiplexing: normalizeMultiplexing(process.env.MIERU_MULTIPLEXING, 'MULTIPLEXING_HIGH'),
      updatedAt: null
    };
  }

  getSyncMetadata(configDocument) {
    if (!isPlainObject(configDocument?.oneUiSync)) {
      return {};
    }

    return deepCloneObject(configDocument.oneUiSync);
  }

  normalizeProfile(inputProfile, fallbackProfile) {
    const merged = {
      ...fallbackProfile,
      ...(isPlainObject(inputProfile) ? inputProfile : {})
    };

    const server = String(merged.server || '').trim();

    return {
      server,
      portRange: normalizePortRange(merged.portRange || fallbackProfile.portRange),
      transport: normalizeTransport(merged.transport, fallbackProfile.transport),
      udp: parseBoolean(merged.udp, fallbackProfile.udp),
      multiplexing: normalizeMultiplexing(merged.multiplexing, fallbackProfile.multiplexing),
      updatedAt: merged.updatedAt || null
    };
  }

  getConfiguredUsers(configDocument) {
    const configuredUsers = getObjectValueByPath(configDocument, this.usersPathSegments);
    return normalizeConfiguredUsers(configuredUsers);
  }

  async getPanelUsers() {
    const users = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { startOnFirstUse: true },
          { expireDate: { gt: new Date() } }
        ]
      },
      orderBy: { id: 'asc' },
      select: {
        email: true,
        password: true
      }
    });

    return users.map((user) => ({
      username: user.email,
      password: user.password,
      source: 'panel',
      enabled: true
    }));
  }

  async getProfile() {
    const { parsed } = await this.loadCurrentConfig();
    const metadata = this.getSyncMetadata(parsed);
    const defaults = this.getDefaultProfile();
    const profile = this.normalizeProfile(metadata.profile, defaults);

    return {
      ...profile,
      source: profile.server ? 'stored' : 'default',
      usersPath: this.usersPathSegments.join('.'),
      configPath: this.configPath
    };
  }

  async updateProfile(payload = {}) {
    const { parsed } = await this.loadCurrentConfig();
    const defaults = this.getDefaultProfile();
    const metadata = this.getSyncMetadata(parsed);
    const currentProfile = this.normalizeProfile(metadata.profile, defaults);

    const candidate = {
      ...currentProfile,
      ...(isPlainObject(payload) ? payload : {})
    };

    const server = String(candidate.server || '').trim();
    if (!server) {
      throw new ValidationError('server is required');
    }

    const updatedProfile = this.normalizeProfile(
      {
        ...candidate,
        server,
        updatedAt: new Date().toISOString()
      },
      defaults
    );

    const nextConfig = deepCloneObject(parsed);
    nextConfig.oneUiSync = {
      ...metadata,
      managedBy: 'one-ui',
      schemaVersion: Math.max(Number.parseInt(String(metadata.schemaVersion || '1'), 10) || 1, 2),
      profile: updatedProfile,
      updatedAt: updatedProfile.updatedAt
    };

    await this.writeConfigAtomically(`${JSON.stringify(nextConfig, null, 2)}\n`);

    return {
      ...updatedProfile,
      usersPath: this.usersPathSegments.join('.'),
      configPath: this.configPath
    };
  }

  async persistCustomUsers(customUsers, reason) {
    const normalizedCustomUsers = normalizeCustomUsers(customUsers);
    const { parsed } = await this.loadCurrentConfig();
    const metadata = this.getSyncMetadata(parsed);
    const nextConfig = deepCloneObject(parsed);

    nextConfig.oneUiSync = {
      ...metadata,
      managedBy: 'one-ui',
      schemaVersion: Math.max(Number.parseInt(String(metadata.schemaVersion || '1'), 10) || 1, 2),
      customUsers: normalizedCustomUsers,
      updatedAt: new Date().toISOString()
    };

    await this.writeConfigAtomically(`${JSON.stringify(nextConfig, null, 2)}\n`);

    const syncResult = await mieruSyncService.syncUsers({
      reason,
      force: true
    });

    return {
      customUsers: normalizedCustomUsers,
      syncResult
    };
  }

  mergeUsers({ panelUsers, customUsers, configuredUsers, onlineByUsername = new Map() }) {
    const panelByUsername = new Map(panelUsers.map((user) => [user.username, user]));
    const customByUsername = new Map(customUsers.map((user) => [user.name, user]));
    const configuredByUsername = new Map(configuredUsers.map((user) => [user.name, user]));

    const usernames = new Set([
      ...Array.from(panelByUsername.keys()),
      ...Array.from(customByUsername.keys()),
      ...Array.from(configuredByUsername.keys())
    ]);

    return Array.from(usernames)
      .map((username) => {
        const panelUser = panelByUsername.get(username);
        const customUser = customByUsername.get(username);
        const configuredUser = configuredByUsername.get(username);

        const source = customUser ? 'custom' : panelUser ? 'panel' : 'config';
        const enabled = customUser ? Boolean(customUser.enabled) : true;
        const password = configuredUser?.password || customUser?.password || panelUser?.password || '';

        return {
          username,
          password,
          source,
          enabled,
          configured: Boolean(configuredUser),
          online: Boolean(onlineByUsername.get(username)),
          updatedAt: customUser?.updatedAt || null,
          createdAt: customUser?.createdAt || null
        };
      })
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  async listUsers({ includeOnline = false } = {}) {
    const [configState, panelUsers] = await Promise.all([
      this.loadCurrentConfig(),
      this.getPanelUsers()
    ]);

    const metadata = this.getSyncMetadata(configState.parsed);
    const customUsers = normalizeCustomUsers(metadata.customUsers);
    const configuredUsers = this.getConfiguredUsers(configState.parsed);

    let onlineByUsername = new Map();
    let onlineSnapshot = null;

    if (includeOnline) {
      onlineSnapshot = await this.getOnlineSnapshotInternal(configuredUsers.map((entry) => entry.name));
      onlineByUsername = new Map(onlineSnapshot.users.map((entry) => [entry.username, entry.online]));
    }

    const users = this.mergeUsers({
      panelUsers,
      customUsers,
      configuredUsers,
      onlineByUsername
    });

    const onlineCount = users.filter((entry) => entry.online).length;

    return {
      users,
      stats: {
        total: users.length,
        configured: users.filter((entry) => entry.configured).length,
        panel: users.filter((entry) => entry.source === 'panel').length,
        custom: users.filter((entry) => entry.source === 'custom').length,
        online: onlineCount
      },
      sync: {
        usersPath: this.usersPathSegments.join('.'),
        configPath: this.configPath,
        usersHash: metadata.usersHash || null,
        lastSyncedAt: metadata.lastSyncedAt || null
      },
      onlineSnapshot
    };
  }

  assertUniqueUsername(username, panelUsers, customUsers, ignoreUsername = null) {
    const normalizedIgnore = ignoreUsername ? String(ignoreUsername).trim() : null;

    if (username !== normalizedIgnore && panelUsers.some((user) => user.username === username)) {
      throw new ConflictError('username conflicts with an existing panel user email');
    }

    if (
      username !== normalizedIgnore
      && customUsers.some((user) => user.name === username)
    ) {
      throw new ConflictError('custom Mieru user already exists');
    }
  }

  async createCustomUser(payload = {}) {
    const username = normalizeUsername(payload.username);
    const password = normalizePassword(payload.password);
    const enabled = payload.enabled === undefined ? true : Boolean(payload.enabled);

    const [configState, panelUsers] = await Promise.all([
      this.loadCurrentConfig(),
      this.getPanelUsers()
    ]);

    const metadata = this.getSyncMetadata(configState.parsed);
    const customUsers = normalizeCustomUsers(metadata.customUsers);

    this.assertUniqueUsername(username, panelUsers, customUsers);

    const now = new Date().toISOString();
    const nextCustomUsers = [
      ...customUsers,
      {
        name: username,
        password,
        enabled,
        createdAt: now,
        updatedAt: now
      }
    ];

    const result = await this.persistCustomUsers(nextCustomUsers, `api.mieru.custom-user.create.${username}`);

    return {
      user: {
        username,
        password,
        source: 'custom',
        enabled,
        configured: true,
        online: false,
        createdAt: now,
        updatedAt: now
      },
      syncResult: result.syncResult
    };
  }

  async updateCustomUser(targetUsername, payload = {}) {
    const normalizedTarget = normalizeUsername(targetUsername);

    const [configState, panelUsers] = await Promise.all([
      this.loadCurrentConfig(),
      this.getPanelUsers()
    ]);

    const metadata = this.getSyncMetadata(configState.parsed);
    const customUsers = normalizeCustomUsers(metadata.customUsers);

    const targetIndex = customUsers.findIndex((entry) => entry.name === normalizedTarget);
    if (targetIndex === -1) {
      throw new NotFoundError('custom Mieru user not found');
    }

    const current = customUsers[targetIndex];
    const username = payload.username === undefined ? current.name : normalizeUsername(payload.username);
    const password = payload.password === undefined ? current.password : normalizePassword(payload.password);
    const enabled = payload.enabled === undefined ? current.enabled : Boolean(payload.enabled);

    this.assertUniqueUsername(
      username,
      panelUsers,
      customUsers.filter((_, index) => index !== targetIndex),
      current.name
    );

    const updatedUser = {
      ...current,
      name: username,
      password,
      enabled,
      updatedAt: new Date().toISOString()
    };

    const nextCustomUsers = [...customUsers];
    nextCustomUsers[targetIndex] = updatedUser;

    const result = await this.persistCustomUsers(nextCustomUsers, `api.mieru.custom-user.update.${username}`);

    return {
      user: {
        username: updatedUser.name,
        password: updatedUser.password,
        source: 'custom',
        enabled: updatedUser.enabled,
        configured: true,
        online: false,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt
      },
      syncResult: result.syncResult
    };
  }

  async deleteCustomUser(targetUsername) {
    const normalizedTarget = normalizeUsername(targetUsername);
    const { parsed } = await this.loadCurrentConfig();
    const metadata = this.getSyncMetadata(parsed);
    const customUsers = normalizeCustomUsers(metadata.customUsers);

    const nextCustomUsers = customUsers.filter((entry) => entry.name !== normalizedTarget);
    if (nextCustomUsers.length === customUsers.length) {
      throw new NotFoundError('custom Mieru user not found');
    }

    const result = await this.persistCustomUsers(nextCustomUsers, `api.mieru.custom-user.delete.${normalizedTarget}`);

    return {
      deleted: true,
      username: normalizedTarget,
      syncResult: result.syncResult
    };
  }

  async runMitaCommand(args) {
    const policy = mieruRuntimeService.getPolicy();
    const timeoutMs = Number.parseInt(String(process.env.MIERU_COMMAND_TIMEOUT_MS || 7000), 10);

    if (!policy.enabled) {
      return {
        ok: false,
        raw: '',
        error: 'Mieru integration disabled'
      };
    }

    const attempts = [];

    if (policy.mode === 'docker') {
      attempts.push(['docker', ['exec', policy.containerName, 'mita', ...args]]);
      attempts.push(['docker', ['exec', policy.containerName, '/usr/local/bin/mita', ...args]]);
      attempts.push(['docker', ['exec', policy.containerName, '/usr/bin/mita', ...args]]);
    } else {
      const binary = String(process.env.MIERU_MITA_COMMAND || 'mita').trim() || 'mita';
      const commandLine = `${binary} ${args.map((arg) => escapeShellArg(arg)).join(' ')}`;
      attempts.push(['sh', ['-lc', commandLine]]);
    }

    let lastError = 'Unknown command failure';
    let lastRaw = '';

    for (const [command, commandArgs] of attempts) {
      const result = await mieruRuntimeService.runCommand(command, commandArgs, Math.max(timeoutMs, 3000));
      const combined = [result.stdout, result.stderr]
        .filter((entry) => entry && entry.trim().length > 0)
        .join('\n')
        .trim();

      if (result.ok) {
        return {
          ok: true,
          raw: combined,
          error: null
        };
      }

      lastRaw = combined;
      lastError = sanitizeMultiline(combined || 'Mita command failed', 320);
    }

    return {
      ok: false,
      raw: lastRaw,
      error: lastError
    };
  }

  inferOnlineFromOutput(usernames, output, source) {
    const onlineByUsername = new Map();
    if (!output) {
      return onlineByUsername;
    }

    const loweredUsers = usernames.map((username) => ({
      username,
      token: username.toLowerCase()
    }));

    const lines = String(output)
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const line of lines) {
      const normalizedLine = line.toLowerCase();

      for (const user of loweredUsers) {
        if (!normalizedLine.includes(user.token)) {
          continue;
        }

        if (/\boffline\b|inactive|disabled|blocked|revoked/.test(normalizedLine)) {
          onlineByUsername.set(user.username, false);
          continue;
        }

        if (/\bonline\b|connected|active|alive|established/.test(normalizedLine)) {
          onlineByUsername.set(user.username, true);
          continue;
        }

        if (source === 'connections') {
          onlineByUsername.set(user.username, true);
        }
      }
    }

    return onlineByUsername;
  }

  async getOnlineSnapshotInternal(usernames) {
    const uniqueUsernames = Array.from(new Set(usernames.map((entry) => String(entry || '').trim()).filter(Boolean)));

    if (uniqueUsernames.length === 0) {
      return {
        checkedAt: new Date().toISOString(),
        users: [],
        summary: {
          total: 0,
          online: 0,
          offline: 0
        },
        commands: {
          users: { ok: false, error: 'No configured users' },
          connections: { ok: false, error: 'No configured users' }
        }
      };
    }

    const [usersCommand, connectionsCommand] = await Promise.all([
      this.runMitaCommand(['get', 'users']),
      this.runMitaCommand(['get', 'connections'])
    ]);

    const onlineByUsername = new Map(uniqueUsernames.map((username) => [username, false]));

    const usersStatus = this.inferOnlineFromOutput(uniqueUsernames, usersCommand.raw, 'users');
    const connectionStatus = this.inferOnlineFromOutput(uniqueUsernames, connectionsCommand.raw, 'connections');

    for (const [username, online] of usersStatus.entries()) {
      if (online) {
        onlineByUsername.set(username, true);
      }
    }

    for (const [username, online] of connectionStatus.entries()) {
      if (online) {
        onlineByUsername.set(username, true);
      }
    }

    const users = uniqueUsernames.map((username) => ({
      username,
      online: Boolean(onlineByUsername.get(username))
    }));

    const onlineCount = users.filter((entry) => entry.online).length;

    return {
      checkedAt: new Date().toISOString(),
      users,
      summary: {
        total: users.length,
        online: onlineCount,
        offline: users.length - onlineCount
      },
      commands: {
        users: {
          ok: usersCommand.ok,
          error: usersCommand.error
        },
        connections: {
          ok: connectionsCommand.ok,
          error: connectionsCommand.error
        }
      }
    };
  }

  async getOnlineSnapshot() {
    const { parsed } = await this.loadCurrentConfig();
    const configuredUsers = this.getConfiguredUsers(parsed);

    return this.getOnlineSnapshotInternal(configuredUsers.map((entry) => entry.name));
  }

  async getUserExport(username) {
    const normalizedUsername = normalizeUsername(username);
    const usersResult = await this.listUsers({ includeOnline: false });
    const targetUser = usersResult.users.find((entry) => entry.username === normalizedUsername && entry.configured);

    if (!targetUser) {
      throw new NotFoundError('Mieru user not found in current config');
    }

    const profile = await this.getProfile();
    if (!profile.server) {
      throw new ValidationError('Mieru server host is not configured. Save server profile first.');
    }

    const proxyName = `mieru-${normalizedUsername}`;
    const proxy = {
      name: proxyName,
      type: 'mieru',
      server: profile.server,
      'port-range': profile.portRange,
      transport: profile.transport,
      udp: profile.udp,
      username: normalizedUsername,
      password: targetUser.password,
      multiplexing: profile.multiplexing
    };

    const clashProfile = {
      proxies: [proxy],
      'proxy-groups': [],
      rules: [`MATCH,${proxyName}`]
    };

    const clashYaml = yaml.dump(clashProfile, {
      lineWidth: -1,
      noRefs: true
    });

    return {
      username: normalizedUsername,
      profile,
      clashYaml,
      json: {
        type: 'mieru',
        server: profile.server,
        portRange: profile.portRange,
        transport: profile.transport,
        udp: profile.udp,
        username: normalizedUsername,
        password: targetUser.password,
        multiplexing: profile.multiplexing
      }
    };
  }
}

module.exports = new MieruManagerService();
