const { spawn, spawnSync } = require('child_process');
const https = require('node:https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const prisma = require('../config/database');
const logger = require('../config/logger');
const metrics = require('../observability/metrics');
const { ValidationError } = require('../utils/errors');
const { getBotManager } = require('../telegram/bot');
const workerLockService = require('./workerLock.service');
const xrayManager = require('../xray/manager');

const UPDATE_LOG_PREFIX = 'XRAY_UPDATE';
const ONE_UI_ROOT = '/opt/one-ui';
const LEGACY_ROOT = '/opt/xray-panel';

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

function redactCliArgs(args = []) {
  return args.map((arg) => {
    if (typeof arg !== 'string') {
      return arg;
    }
    if (arg.startsWith('--image')) {
      return arg;
    }
    if (arg.toLowerCase().includes('token') || arg.toLowerCase().includes('secret') || arg.toLowerCase().includes('key=')) {
      return '[REDACTED]';
    }
    return arg;
  });
}

function normalizeBackupTag(value) {
  const raw = value === undefined || value === null ? '' : String(value).trim();
  if (!raw) {
    return null;
  }
  if (!/^oneui-xray-backup:[A-Za-z0-9_.-]+$/.test(raw)) {
    throw new ValidationError('backupTag must match oneui-xray-backup:<tag>');
  }
  return raw;
}

function normalizeUnlockReason(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return 'manual-admin-unlock';
  }
  return normalized.slice(0, 120);
}

function normalizeForceUnlock(value) {
  if (value === undefined || value === null || value === '') {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'y'].includes(normalized);
}

function normalizeUpdateMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'docker') {
    return 'docker';
  }
  if (normalized === 'manual') {
    return 'manual';
  }
  return null;
}

function detectDockerAvailable() {
  try {
    const result = spawnSync('docker', ['version'], {
      stdio: 'ignore'
    });
    return result.status === 0;
  } catch (_error) {
    return false;
  }
}

class XrayUpdateService {
  constructor() {
    this.updateTimeoutMs = parsePositiveInt(process.env.XRAY_UPDATE_TIMEOUT_MS, 20 * 60 * 1000, 60_000, 60 * 60 * 1000);
    this.canaryWindowMinutes = parsePositiveInt(process.env.XRAY_UPDATE_CANARY_WINDOW_MINUTES, 360, 10, 7 * 24 * 60);
    this.requireCanary = parseBoolean(process.env.XRAY_UPDATE_REQUIRE_CANARY, true);
    this.updateLockName = String(process.env.XRAY_UPDATE_LOCK_NAME || 'one-ui-xray-update').trim() || 'one-ui-xray-update';
    this.updateLockTtlSeconds = parsePositiveInt(
      process.env.XRAY_UPDATE_LOCK_TTL_SECONDS,
      Math.ceil(this.updateTimeoutMs / 1000) + 120,
      30,
      24 * 60 * 60
    );
    this.preflightTimeoutMs = parsePositiveInt(process.env.XRAY_UPDATE_PREFLIGHT_TIMEOUT_MS, 8_000, 1_000, 5 * 60 * 1000);
    this.xrayContainerName = String(process.env.XRAY_UPDATE_CONTAINER_NAME || process.env.CONTAINER_NAME || 'xray-core').trim() || 'xray-core';
    this.defaultChannel = String(process.env.XRAY_UPDATE_DEFAULT_CHANNEL || 'stable').trim().toLowerCase() === 'latest'
      ? 'latest'
      : 'stable';
    const configuredMode = normalizeUpdateMode(process.env.XRAY_UPDATE_MODE);
    this.updateMode = configuredMode || (detectDockerAvailable() ? 'docker' : 'manual');
    this.updatesEnabled = this.updateMode === 'docker';
    this.stuckLockThresholdMs = parsePositiveInt(
      process.env.XRAY_UPDATE_STUCK_LOCK_THRESHOLD_MS,
      this.updateTimeoutMs + 60_000,
      60_000,
      24 * 60 * 60 * 1000
    );
    this.stuckLockAlertIntervalMs = parsePositiveInt(
      process.env.XRAY_UPDATE_STUCK_LOCK_ALERT_INTERVAL_MS,
      30 * 60 * 1000,
      60_000,
      24 * 60 * 60 * 1000
    );
    this.stuckLockAlertState = new Map();
    this.releaseIntelCache = null;
    this.releaseIntelTtlMs = parsePositiveInt(process.env.XRAY_RELEASE_CACHE_TTL_MS, 10 * 60 * 1000, 30_000, 24 * 60 * 60 * 1000);
    this.releaseIntelRepo = String(process.env.XRAY_RELEASE_REPO || 'XTLS/Xray-core').trim() || 'XTLS/Xray-core';
    this.lockMetricsIntervalMs = parsePositiveInt(
      process.env.XRAY_UPDATE_LOCK_METRICS_INTERVAL_MS,
      15_000,
      5_000,
      5 * 60 * 1000
    );
    this.lockMetricsTimer = null;
    this.lockMetricsInFlight = false;
    this.startLockMetricsLoop();
  }

  getLockMetricsState(lock) {
    if (!lock) {
      return {
        active: 0,
        stale: 0,
        ageSeconds: 0
      };
    }

    const nowMs = Date.now();
    const heartbeatAt = lock.heartbeatAt instanceof Date ? lock.heartbeatAt : null;
    const createdAt = lock.createdAt instanceof Date ? lock.createdAt : null;
    const expiresAtMs = lock.expiresAt instanceof Date ? lock.expiresAt.getTime() : 0;
    const reference = heartbeatAt || createdAt || lock.expiresAt || new Date(nowMs);
    const ageSeconds = Math.max(0, (nowMs - reference.getTime()) / 1000);
    const active = expiresAtMs > nowMs ? 1 : 0;
    const stale = active && ageSeconds * 1000 >= this.stuckLockThresholdMs ? 1 : 0;

    return {
      active,
      stale,
      ageSeconds
    };
  }

  setLockMetrics(lock) {
    metrics.setXrayUpdateLockState(this.getLockMetricsState(lock));
  }

  async refreshLockMetrics() {
    if (this.lockMetricsInFlight) {
      return;
    }
    this.lockMetricsInFlight = true;
    try {
      const lock = await workerLockService.get(this.updateLockName);
      this.setLockMetrics(lock);
    } catch (error) {
      metrics.setXrayUpdateLockState({ active: 0, stale: 0, ageSeconds: 0 });
      logger.debug('Unable to refresh xray update lock metrics', {
        message: error.message,
        lockName: this.updateLockName
      });
    } finally {
      this.lockMetricsInFlight = false;
    }
  }

  startLockMetricsLoop() {
    if (this.lockMetricsTimer) {
      return;
    }

    void this.refreshLockMetrics();
    this.lockMetricsTimer = setInterval(() => {
      void this.refreshLockMetrics();
    }, this.lockMetricsIntervalMs);

    if (typeof this.lockMetricsTimer.unref === 'function') {
      this.lockMetricsTimer.unref();
    }
  }

  ensureScriptedUpdatesEnabled() {
    if (this.updatesEnabled) {
      return;
    }

    throw new ValidationError(
      'Scripted Xray updates are disabled in manual mode. Use your host update workflow.'
    );
  }

  resolveScriptPath() {
    const candidates = [
      process.env.XRAY_UPDATE_SCRIPT,
      path.join(ONE_UI_ROOT, 'scripts/update-xray-core.sh'),
      path.join(LEGACY_ROOT, 'scripts/update-xray-core.sh'),
      path.resolve(process.cwd(), '../scripts/update-xray-core.sh'),
      path.resolve(process.cwd(), 'scripts/update-xray-core.sh'),
      path.resolve(__dirname, '../../..', 'scripts/update-xray-core.sh')
    ]
      .filter(Boolean)
      .map((candidate) => path.resolve(String(candidate)));

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch (_error) {
        continue;
      }
    }

    return null;
  }

  isExecutable(filePath) {
    if (!filePath) {
      return false;
    }
    try {
      fs.accessSync(filePath, fs.constants.X_OK);
      return true;
    } catch (_error) {
      return false;
    }
  }

  normalizeChannel(channel) {
    const value = String(channel || this.defaultChannel).trim().toLowerCase();
    if (!['stable', 'latest'].includes(value)) {
      throw new ValidationError('channel must be one of: stable, latest');
    }
    return value;
  }

  normalizeImage(image) {
    const value = image === undefined || image === null ? '' : String(image).trim();
    if (!value) {
      return null;
    }

    if (!/^[a-zA-Z0-9./:_-]+$/.test(value)) {
      throw new ValidationError('image contains invalid characters');
    }

    return value;
  }

  normalizeStage(stage) {
    const value = String(stage || '').trim().toLowerCase();
    if (value === 'canary') {
      return 'canary';
    }
    if (value === 'full') {
      return 'full';
    }
    if (value === 'rollback') {
      return 'rollback';
    }
    throw new ValidationError('stage must be canary, full, or rollback');
  }

  buildArgs({ channel, image, stage, noRollback = false, backupTag = null }) {
    const args = [];

    if (stage === 'rollback') {
      args.push('--rollback', '--yes');
      if (backupTag) {
        args.push('--backup-tag', backupTag);
      }
      return args;
    }

    if (image) {
      args.push('--image', image);
    } else {
      args.push(`--${channel}`);
    }

    args.push('--canary', '--yes');

    if (stage === 'canary') {
      args.push('--no-restart');
    }
    if (noRollback) {
      args.push('--no-rollback');
    }

    return args;
  }

  async executeScript(scriptPath, args = []) {
    return new Promise((resolve) => {
      const child = spawn(scriptPath, args, {
        cwd: path.resolve(__dirname, '../../..'),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, this.updateTimeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          code: null,
          signal: null,
          timedOut: false,
          stdout: stdout.trim(),
          stderr: error.message
        });
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolve({
          ok: !timedOut && code === 0,
          code,
          signal,
          timedOut,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      });
    });
  }

  async executeCommand(command, args = [], timeoutMs = this.preflightTimeoutMs) {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: path.resolve(__dirname, '../../..'),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          code: null,
          signal: null,
          timedOut: false,
          stdout: stdout.trim(),
          stderr: error.message
        });
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolve({
          ok: !timedOut && code === 0,
          code,
          signal,
          timedOut,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      });
    });
  }

  buildPreflightCheck({ id, label, ok, blocking = true, detail = '', metadata = null }) {
    return {
      id,
      label,
      ok: Boolean(ok),
      blocking: Boolean(blocking),
      detail: detail || '',
      metadata: metadata || null
    };
  }

  resolveComposeFilePath() {
    const candidates = [
      process.env.COMPOSE_FILE,
      path.join(ONE_UI_ROOT, 'docker-compose.yml'),
      path.join(LEGACY_ROOT, 'docker-compose.yml'),
      path.resolve(process.cwd(), '../docker-compose.yml'),
      path.resolve(process.cwd(), 'docker-compose.yml'),
      path.resolve(__dirname, '../../..', 'docker-compose.yml')
    ].filter(Boolean);

    for (const candidate of candidates) {
      const filePath = path.resolve(String(candidate));
      try {
        if (fs.existsSync(filePath)) {
          return filePath;
        }
      } catch (_error) {
        continue;
      }
    }

    return null;
  }

  async runComposeCommand(composeFilePath, args = [], timeoutMs = this.updateTimeoutMs) {
    const composeArgs = ['-f', composeFilePath, ...args];

    let result = await this.executeCommand('docker', ['compose', ...composeArgs], timeoutMs);
    const combined = `${result.stderr || ''}\n${result.stdout || ''}`.toLowerCase();
    const composeUnavailable =
      !result.ok
      && (
        result.code === 127
        || combined.includes('is not a docker command')
        || combined.includes('unknown command')
        || combined.includes('not found')
        || combined.includes('no such file or directory')
      );

    if (result.ok || !composeUnavailable) {
      return result;
    }

    result = await this.executeCommand('docker-compose', composeArgs, timeoutMs);
    return result;
  }

  async tryRepairScriptExecutable(scriptPath) {
    if (!scriptPath) {
      return {
        repaired: false,
        detail: 'Update script path is missing.'
      };
    }

    if (this.isExecutable(scriptPath)) {
      return {
        repaired: false,
        detail: 'Script is already executable.'
      };
    }

    try {
      fs.chmodSync(scriptPath, 0o755);
      if (this.isExecutable(scriptPath)) {
        return {
          repaired: true,
          detail: `Applied chmod +x to ${scriptPath}.`
        };
      }
    } catch (_error) {
      // Fall through to docker-based repair.
    }

    const dockerResult = await this.executeCommand('docker', ['version', '--format', '{{.Server.Version}}']);
    if (!dockerResult.ok) {
      return {
        repaired: false,
        detail: 'Script is not executable and Docker daemon is unavailable for auto-repair.'
      };
    }

    let mountRoot = null;
    if (scriptPath.startsWith(`${ONE_UI_ROOT}/`)) {
      mountRoot = ONE_UI_ROOT;
    } else if (scriptPath.startsWith(`${LEGACY_ROOT}/`)) {
      mountRoot = LEGACY_ROOT;
    } else {
      return {
        repaired: false,
        detail: `Script is not executable and cannot auto-repair nonstandard path: ${scriptPath}`
      };
    }

    const relativePath = path.relative(mountRoot, scriptPath);
    if (relativePath.startsWith('..')) {
      return {
        repaired: false,
        detail: 'Script path is outside the mount root and cannot be auto-repaired.'
      };
    }

    const targetPath = `/workspace/${relativePath}`;
    const repairResult = await this.executeCommand(
      'docker',
      ['run', '--rm', '-v', `${mountRoot}:/workspace`, 'alpine:3.20', 'chmod', '+x', targetPath],
      this.preflightTimeoutMs
    );

    if (!repairResult.ok) {
      return {
        repaired: false,
        detail: repairResult.stderr || repairResult.stdout || 'Failed to auto-repair script executable bit.'
      };
    }

    return {
      repaired: this.isExecutable(scriptPath),
      detail: this.isExecutable(scriptPath)
        ? `Applied chmod +x to ${scriptPath} via docker helper.`
        : `Attempted chmod +x for ${scriptPath}, but executable bit is still missing.`
    };
  }

  async runRuntimeDoctor(options = {}, actor = null) {
    const repair = parseBoolean(options.repair, true);
    const source = String(options.source || 'manual').trim() || 'manual';
    const checks = [];
    const actions = [];
    const scriptPath = this.resolveScriptPath();
    const composeFilePath = this.resolveComposeFilePath();
    const dockerRequired = this.updatesEnabled;

    checks.push({
      id: 'update-runtime',
      label: 'Update runtime mode',
      ok: true,
      blocking: true,
      repaired: false,
      detail: this.updatesEnabled
        ? `Docker scripted updates are enabled (mode=${this.updateMode}).`
        : `Manual mode detected (mode=${this.updateMode}); scripted updates are disabled.`,
      metadata: {
        mode: this.updateMode,
        updatesEnabled: this.updatesEnabled
      }
    });

    let scriptExists = Boolean(scriptPath);
    checks.push({
      id: 'update-script',
      label: 'Update script',
      ok: scriptExists,
      blocking: dockerRequired,
      repaired: false,
      detail: scriptExists ? `Using ${scriptPath}` : 'Update script not found.',
      metadata: {
        scriptPath: scriptPath || null
      }
    });

    let scriptExecutable = this.isExecutable(scriptPath);
    let scriptExecutableRepaired = false;
    let scriptExecutableDetail = scriptExecutable
      ? 'Script is executable.'
      : 'Script is not executable.';

    if (repair && scriptPath && !scriptExecutable) {
      const repairResult = await this.tryRepairScriptExecutable(scriptPath);
      scriptExecutable = this.isExecutable(scriptPath);
      scriptExecutableRepaired = scriptExecutable && repairResult.repaired;
      scriptExecutableDetail = repairResult.detail;

      if (scriptExecutableRepaired) {
        actions.push(repairResult.detail);
      }
    }

    checks.push({
      id: 'update-script-executable',
      label: 'Script executable',
      ok: scriptExecutable,
      blocking: dockerRequired,
      repaired: scriptExecutableRepaired,
      detail: scriptExecutableDetail,
      metadata: {
        scriptPath: scriptPath || null
      }
    });

    checks.push({
      id: 'compose-file',
      label: 'Compose file',
      ok: Boolean(composeFilePath),
      blocking: dockerRequired,
      repaired: false,
      detail: composeFilePath ? `Using ${composeFilePath}` : 'docker-compose.yml not found.',
      metadata: {
        composeFilePath: composeFilePath || null
      }
    });

    const dockerResult = await this.executeCommand('docker', ['version', '--format', '{{.Server.Version}}']);
    checks.push({
      id: 'docker-daemon',
      label: 'Docker daemon',
      ok: dockerResult.ok,
      blocking: dockerRequired,
      repaired: false,
      detail: dockerResult.ok
        ? `Docker server ${dockerResult.stdout || 'ready'}`
        : (dockerResult.stderr || dockerResult.stdout || 'Unable to reach Docker daemon'),
      metadata: {
        command: 'docker version --format "{{.Server.Version}}"'
      }
    });

    let xrayContainerRunning = false;
    let xrayContainerRepaired = false;
    let xrayContainerDetail = 'Skipped because Docker daemon is unavailable.';
    if (dockerResult.ok) {
      const runningCheck = await this.executeCommand('docker', ['ps', '--filter', `name=^/${this.xrayContainerName}$`, '--format', '{{.Names}}']);
      xrayContainerRunning = runningCheck.ok && runningCheck.stdout.split('\n').some((line) => line.trim() === this.xrayContainerName);
      xrayContainerDetail = xrayContainerRunning
        ? `Container ${this.xrayContainerName} is running.`
        : `Container ${this.xrayContainerName} is not running right now.`;

      if (repair && !xrayContainerRunning && composeFilePath) {
        const upResult = await this.runComposeCommand(composeFilePath, ['up', '-d', 'xray']);
        if (upResult.ok) {
          const verifyResult = await this.executeCommand('docker', ['ps', '--filter', `name=^/${this.xrayContainerName}$`, '--format', '{{.Names}}']);
          xrayContainerRunning = verifyResult.ok && verifyResult.stdout.split('\n').some((line) => line.trim() === this.xrayContainerName);
          if (xrayContainerRunning) {
            xrayContainerRepaired = true;
            xrayContainerDetail = `Container ${this.xrayContainerName} restarted via compose.`;
            actions.push(`Restarted ${this.xrayContainerName} via docker compose.`);
          } else {
            xrayContainerDetail = 'Compose command executed, but xray container is still not running.';
          }
        } else {
          xrayContainerDetail = upResult.stderr || upResult.stdout || 'Failed to start xray service via compose.';
        }
      }
    }

    checks.push({
      id: 'xray-container',
      label: 'Xray container',
      ok: xrayContainerRunning,
      blocking: false,
      repaired: xrayContainerRepaired,
      detail: xrayContainerDetail,
      metadata: {
        containerName: this.xrayContainerName
      }
    });

    const preflight = await this.getPreflight();
    const blockingChecks = checks.filter((check) => check.blocking);
    const blockingFailures = blockingChecks.filter((check) => !check.ok).length;
    const ok = preflight.ready && blockingFailures === 0;

    await this.logEvent({
      level: ok ? 'INFO' : 'WARNING',
      message: `${UPDATE_LOG_PREFIX}: stage=doctor status=${ok ? 'success' : 'failed'} channel=n/a`,
      metadata: {
        source,
        repair,
        mode: this.updateMode,
        updatesEnabled: this.updatesEnabled,
        repairedCount: checks.filter((check) => check.repaired).length,
        blockingFailures,
        actorId: actor?.id || null,
        actorUsername: actor?.username || null
      }
    });

    return {
      ok,
      mode: this.updateMode,
      updatesEnabled: this.updatesEnabled,
      source,
      repair,
      repairedCount: checks.filter((check) => check.repaired).length,
      generatedAt: new Date().toISOString(),
      actions,
      checks,
      preflight
    };
  }

  async runStartupSelfHeal() {
    if (!parseBoolean(process.env.XRAY_STARTUP_SELF_HEAL, true)) {
      return {
        skipped: true,
        reason: 'XRAY_STARTUP_SELF_HEAL disabled'
      };
    }

    try {
      return await this.runRuntimeDoctor({ repair: true, source: 'startup' });
    } catch (error) {
      logger.warn('Xray update startup self-heal failed', {
        message: error.message
      });
      return {
        skipped: false,
        ok: false,
        error: error.message
      };
    }
  }

  buildStuckLockSignature(lock) {
    if (!lock) {
      return null;
    }
    const expiresAt = lock.expiresAt instanceof Date ? lock.expiresAt.toISOString() : String(lock.expiresAt || '');
    return `${this.updateLockName}:${lock.ownerId}:${expiresAt}`;
  }

  pruneStuckLockAlertState() {
    if (this.stuckLockAlertState.size <= 200) {
      return;
    }
    const cutoff = Date.now() - (this.stuckLockAlertIntervalMs * 4);
    for (const [signature, timestamp] of this.stuckLockAlertState.entries()) {
      if (timestamp < cutoff) {
        this.stuckLockAlertState.delete(signature);
      }
    }
  }

  shouldSendStuckLockAlert(signature) {
    if (!signature) {
      return false;
    }
    const now = Date.now();
    const lastSentAt = this.stuckLockAlertState.get(signature) || 0;
    if (now - lastSentAt < this.stuckLockAlertIntervalMs) {
      return false;
    }
    this.stuckLockAlertState.set(signature, now);
    this.pruneStuckLockAlertState();
    return true;
  }

  clearStuckLockAlert(signature) {
    if (!signature) {
      return;
    }
    this.stuckLockAlertState.delete(signature);
  }

  async emitStuckLockAlert(lock, lockAgeMs = 0) {
    const signature = this.buildStuckLockSignature(lock);
    if (!this.shouldSendStuckLockAlert(signature)) {
      return false;
    }

    const lockAgeSeconds = Math.floor(Math.max(0, lockAgeMs) / 1000);
    this.setLockMetrics(lock);
    const thresholdSeconds = Math.floor(this.stuckLockThresholdMs / 1000);
    const expiresAt = lock.expiresAt instanceof Date ? lock.expiresAt.toISOString() : String(lock.expiresAt || '');
    const heartbeatAt = lock.heartbeatAt instanceof Date ? lock.heartbeatAt.toISOString() : String(lock.heartbeatAt || '');

    await this.logEvent({
      level: 'WARNING',
      message: `${UPDATE_LOG_PREFIX}: stage=lock status=stuck-alert channel=n/a`,
      metadata: {
        lockName: this.updateLockName,
        ownerId: lock.ownerId,
        expiresAt,
        heartbeatAt: heartbeatAt || null,
        lockAgeSeconds,
        thresholdSeconds
      }
    });

    try {
      const botManager = getBotManager();
      if (botManager?.enabled && typeof botManager.sendPlainAlert === 'function') {
        const lines = [
          'One-UI Xray Update Lock Alert',
          `lock=${this.updateLockName}`,
          `owner=${lock.ownerId}`,
          `age=${lockAgeSeconds}s`,
          `threshold=${thresholdSeconds}s`,
          `expiresAt=${expiresAt}`
        ];
        await botManager.sendPlainAlert(lines.join('\n'));
      }
    } catch (error) {
      logger.error('Failed to send stuck lock alert', {
        message: error.message,
        stack: error.stack,
        lockName: this.updateLockName
      });
    }

    return true;
  }

  async getPreflight() {
    const checks = [];
    const scriptPath = this.resolveScriptPath();
    const composeFilePath = this.resolveComposeFilePath();

    checks.push(
      this.buildPreflightCheck({
        id: 'update-runtime',
        label: 'Update runtime mode',
        ok: true,
        blocking: true,
        detail: this.updatesEnabled
          ? 'Docker scripted updates are enabled.'
          : 'Manual mode active: scripted container updates are disabled.',
        metadata: {
          mode: this.updateMode,
          updatesEnabled: this.updatesEnabled
        }
      })
    );

    if (!this.updatesEnabled) {
      const scriptExecutable = this.isExecutable(scriptPath);
      checks.push(
        this.buildPreflightCheck({
          id: 'update-script',
          label: 'Update script',
          ok: true,
          blocking: false,
          detail: scriptPath
            ? `Found ${scriptPath} (not used in manual mode).`
            : 'No update script found (manual mode does not require it).',
          metadata: {
            scriptPath: scriptPath || null
          }
        }),
        this.buildPreflightCheck({
          id: 'update-script-executable',
          label: 'Script executable',
          ok: true,
          blocking: false,
          detail: scriptPath
            ? (scriptExecutable ? 'Script is executable (manual mode).' : 'Script is not executable (manual mode).')
            : 'No script to validate (manual mode).',
          metadata: {
            scriptPath: scriptPath || null
          }
        }),
        this.buildPreflightCheck({
          id: 'compose-file',
          label: 'Compose file',
          ok: true,
          blocking: false,
          detail: composeFilePath
            ? `Found ${composeFilePath} (manual mode does not require Docker compose).`
            : 'Compose file not found (manual mode).',
          metadata: {
            composeFilePath: composeFilePath || null
          }
        }),
        this.buildPreflightCheck({
          id: 'docker-daemon',
          label: 'Docker daemon',
          ok: true,
          blocking: false,
          detail: 'Skipped in manual mode.',
          metadata: {
            skipped: true,
            mode: this.updateMode
          }
        }),
        this.buildPreflightCheck({
          id: 'xray-container',
          label: 'Xray container',
          ok: true,
          blocking: false,
          detail: 'Skipped in manual mode.',
          metadata: {
            skipped: true,
            containerName: this.xrayContainerName
          }
        }),
        this.buildPreflightCheck({
          id: 'xray-version-read',
          label: 'Xray version read',
          ok: true,
          blocking: false,
          detail: 'Skipped in manual mode.',
          metadata: {
            skipped: true,
            mode: this.updateMode
          }
        }),
        this.buildPreflightCheck({
          id: 'update-script-dry-run',
          label: 'Script dry-run',
          ok: true,
          blocking: false,
          detail: 'Skipped in manual mode.',
          metadata: {
            skipped: true,
            command: scriptPath ? `${scriptPath} --stable --canary --no-restart --dry-run --yes` : null
          }
        })
      );
    } else {

      checks.push(
        this.buildPreflightCheck({
          id: 'update-script',
          label: 'Update script',
          ok: Boolean(scriptPath),
          detail: scriptPath ? `Using ${scriptPath}` : 'Update script not found. Set XRAY_UPDATE_SCRIPT.',
          metadata: {
            scriptPath: scriptPath || null
          }
        })
      );

      const scriptExecutable = this.isExecutable(scriptPath);
      checks.push(
        this.buildPreflightCheck({
          id: 'update-script-executable',
          label: 'Script executable',
          ok: scriptExecutable,
          detail: scriptExecutable ? 'Script is executable.' : 'Script is not executable (`chmod +x`).',
          metadata: {
            scriptPath: scriptPath || null
          }
        })
      );

      checks.push(
        this.buildPreflightCheck({
          id: 'compose-file',
          label: 'Compose file',
          ok: Boolean(composeFilePath),
          detail: composeFilePath ? `Using ${composeFilePath}` : 'docker-compose.yml not found.',
          metadata: {
            composeFilePath: composeFilePath || null
          }
        })
      );

      const dockerResult = await this.executeCommand('docker', ['version', '--format', '{{.Server.Version}}']);
      checks.push(
        this.buildPreflightCheck({
          id: 'docker-daemon',
          label: 'Docker daemon',
          ok: dockerResult.ok,
          detail: dockerResult.ok
            ? `Docker server ${dockerResult.stdout || 'ready'}`
            : (dockerResult.stderr || dockerResult.stdout || 'Unable to reach Docker daemon'),
          metadata: {
            command: 'docker version --format "{{.Server.Version}}"'
          }
        })
      );

      let xrayContainerRunning = false;
      if (dockerResult.ok) {
        const runningCheck = await this.executeCommand('docker', ['ps', '--filter', `name=^/${this.xrayContainerName}$`, '--format', '{{.Names}}']);
        xrayContainerRunning = runningCheck.ok && runningCheck.stdout.split('\n').some((line) => line.trim() === this.xrayContainerName);
        checks.push(
          this.buildPreflightCheck({
            id: 'xray-container',
            label: 'Xray container',
            ok: xrayContainerRunning,
            blocking: false,
            detail: xrayContainerRunning
              ? `Container ${this.xrayContainerName} is running.`
              : `Container ${this.xrayContainerName} is not running right now.`,
            metadata: {
              containerName: this.xrayContainerName
            }
          })
        );

        if (xrayContainerRunning) {
          const versionResult = await this.executeCommand('docker', ['exec', this.xrayContainerName, 'xray', 'version']);
          checks.push(
            this.buildPreflightCheck({
              id: 'xray-version-read',
              label: 'Xray version read',
              ok: versionResult.ok,
              blocking: false,
              detail: versionResult.ok
                ? (versionResult.stdout.split('\n')[0] || 'Xray version read success.')
                : (versionResult.stderr || versionResult.stdout || 'Unable to read Xray version from container.'),
              metadata: {
                containerName: this.xrayContainerName,
                command: `docker exec ${this.xrayContainerName} xray version`
              }
            })
          );
        }
      } else {
        checks.push(
          this.buildPreflightCheck({
            id: 'xray-container',
            label: 'Xray container',
            ok: false,
            blocking: false,
            detail: 'Skipped because Docker daemon is unavailable.',
            metadata: {
              containerName: this.xrayContainerName
            }
          })
        );
      }

      if (scriptPath && scriptExecutable) {
        const dryRunCommand = `${scriptPath} --stable --canary --no-restart --dry-run --yes`;
        const dryRunResult = await this.executeScript(scriptPath, ['--stable', '--canary', '--no-restart', '--dry-run', '--yes']);
        checks.push(
          this.buildPreflightCheck({
            id: 'update-script-dry-run',
            label: 'Script dry-run',
            ok: dryRunResult.ok,
            detail: dryRunResult.ok
              ? 'Dry-run succeeded.'
              : (dryRunResult.stderr || dryRunResult.stdout || 'Dry-run failed'),
            metadata: {
              command: dryRunCommand
            }
          })
        );
      } else {
        checks.push(
          this.buildPreflightCheck({
            id: 'update-script-dry-run',
            label: 'Script dry-run',
            ok: false,
            detail: 'Skipped because script is missing or not executable.',
            metadata: {
              command: scriptPath ? `${scriptPath} --stable --canary --no-restart --dry-run --yes` : null
            }
          })
        );
      }
    }

    let lockDetail = 'No active update lock.';
    let lockOk = true;
    let lockMetadata = null;
    try {
      const lock = await workerLockService.get(this.updateLockName);
      this.setLockMetrics(lock);
      if (lock && lock.expiresAt && lock.expiresAt.getTime() > Date.now()) {
        lockOk = false;
        const lockStartAt = lock.heartbeatAt || lock.createdAt || new Date();
        const lockAgeMs = Math.max(0, Date.now() - lockStartAt.getTime());
        const stuck = lockAgeMs >= this.stuckLockThresholdMs;

        lockDetail = `Locked by ${lock.ownerId} until ${lock.expiresAt.toISOString()}`;
        if (stuck) {
          lockDetail += ` (possible stale lock: ${Math.floor(lockAgeMs / 1000)}s old)`;
          await this.emitStuckLockAlert(lock, lockAgeMs);
        }
        lockMetadata = {
          ownerId: lock.ownerId,
          expiresAt: lock.expiresAt.toISOString(),
          heartbeatAt: lock.heartbeatAt ? lock.heartbeatAt.toISOString() : null,
          lockAgeSeconds: Math.floor(lockAgeMs / 1000),
          stuck,
          stuckThresholdSeconds: Math.floor(this.stuckLockThresholdMs / 1000)
        };
      }
    } catch (error) {
      metrics.setXrayUpdateLockState({ active: 0, stale: 0, ageSeconds: 0 });
      lockOk = false;
      lockDetail = `Unable to read lock status: ${error.message}`;
      lockMetadata = {
        error: error.message
      };
    }

    checks.push(
      this.buildPreflightCheck({
        id: 'update-lock',
        label: 'Update lock',
        ok: lockOk,
        blocking: this.updatesEnabled,
        detail: lockDetail,
        metadata: {
          lockName: this.updateLockName,
          ...(lockMetadata || {})
        }
      })
    );

    const blockingChecks = checks.filter((check) => check.blocking);
    const ready = blockingChecks.every((check) => check.ok);

    return {
      ready,
      mode: this.updateMode,
      updatesEnabled: this.updatesEnabled,
      lockName: this.updateLockName,
      generatedAt: new Date().toISOString(),
      checks
    };
  }

  buildSummary(result) {
    const output = [result.stdout || '', result.stderr || ''].filter(Boolean).join('\n');
    const lines = output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const summary = lines
      .filter((line) => line.toLowerCase().includes('version:')
        || line.toLowerCase().includes('update completed')
        || line.toLowerCase().includes('rollback')
        || line.toLowerCase().includes('canary'))
      .slice(-8);

    return {
      summary: summary.join('\n') || null,
      outputTail: lines.slice(-30).join('\n') || null
    };
  }

  parseBackupTagFromOutput(result) {
    const output = [result.stdout || '', result.stderr || ''].join('\n');
    const match = output.match(/BACKUP_TAG=(oneui-xray-backup:[A-Za-z0-9_.-]+)/);
    return match ? match[1] : null;
  }

  async logEvent({
    level = 'INFO',
    message,
    metadata = {}
  }) {
    try {
      await prisma.systemLog.create({
        data: {
          level,
          message,
          metadata
        }
      });
    } catch (error) {
      logger.error('Failed to persist xray update log', {
        message: error.message,
        stack: error.stack
      });
    }
  }

  normalizeVersion(rawVersion = '') {
    const value = String(rawVersion || '').trim();
    const match = value.match(/v?(\d+\.\d+\.\d+)/i);
    return match ? match[1] : '';
  }

  compareVersions(versionA, versionB) {
    const a = this.normalizeVersion(versionA).split('.').map((entry) => Number.parseInt(entry, 10));
    const b = this.normalizeVersion(versionB).split('.').map((entry) => Number.parseInt(entry, 10));
    if (a.length !== 3 || b.length !== 3 || a.some(Number.isNaN) || b.some(Number.isNaN)) {
      return 0;
    }

    for (let index = 0; index < 3; index += 1) {
      if (a[index] > b[index]) {
        return 1;
      }
      if (a[index] < b[index]) {
        return -1;
      }
    }
    return 0;
  }

  async httpGetJson(url) {
    return new Promise((resolve, reject) => {
      const request = https.get(
        url,
        {
          headers: {
            'User-Agent': 'One-UI-Xray-Update-Service'
          }
        },
        (response) => {
          if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            resolve(this.httpGetJson(response.headers.location));
            return;
          }

          if (!response.statusCode || response.statusCode >= 400) {
            reject(new Error(`Request failed with status ${response.statusCode || 'unknown'}`));
            return;
          }

          let raw = '';
          response.on('data', (chunk) => {
            raw += chunk.toString();
          });
          response.on('end', () => {
            try {
              resolve(JSON.parse(raw));
            } catch (error) {
              reject(error);
            }
          });
        }
      );

      request.on('error', reject);
    });
  }

  mapReleaseEntry(release) {
    return {
      id: release.id,
      tagName: release.tag_name,
      name: release.name || release.tag_name,
      publishedAt: release.published_at,
      prerelease: Boolean(release.prerelease),
      draft: Boolean(release.draft),
      url: release.html_url
    };
  }

  findStableRelease(releases = []) {
    return releases.find((release) => !release.draft && !release.prerelease) || null;
  }

  findLatestRelease(releases = []) {
    return releases.find((release) => !release.draft) || null;
  }

  async getReleaseIntel({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && this.releaseIntelCache && now - this.releaseIntelCache.fetchedAtMs < this.releaseIntelTtlMs) {
      return this.releaseIntelCache.payload;
    }

    const apiUrl = `https://api.github.com/repos/${this.releaseIntelRepo}/releases?per_page=20`;
    const releases = await this.httpGetJson(apiUrl);
    if (!Array.isArray(releases)) {
      throw new ValidationError('Unexpected GitHub releases response');
    }

    const stable = this.findStableRelease(releases);
    const latest = this.findLatestRelease(releases);
    const currentVersion = await xrayManager.getVersion();
    const normalizedCurrentVersion = this.normalizeVersion(currentVersion);
    const stableVersion = this.normalizeVersion(stable?.tag_name || '');
    const latestVersion = this.normalizeVersion(latest?.tag_name || '');

    const payload = {
      repository: this.releaseIntelRepo,
      source: 'github',
      fetchedAt: new Date().toISOString(),
      currentVersion: normalizedCurrentVersion || currentVersion || 'unknown',
      channels: {
        stable: stable
          ? {
              ...this.mapReleaseEntry(stable),
              version: stableVersion || stable.tag_name,
              needsUpdate: stableVersion ? this.compareVersions(stableVersion, normalizedCurrentVersion) > 0 : false
            }
          : null,
        latest: latest
          ? {
              ...this.mapReleaseEntry(latest),
              version: latestVersion || latest.tag_name,
              needsUpdate: latestVersion ? this.compareVersions(latestVersion, normalizedCurrentVersion) > 0 : false
            }
          : null
      },
      recent: releases
        .filter((release) => !release.draft)
        .slice(0, 10)
        .map((release) => this.mapReleaseEntry(release))
    };

    this.releaseIntelCache = {
      fetchedAtMs: now,
      payload
    };

    return payload;
  }

  async notifyTelegram({ ok, stage, channel, actor, summary }) {
    try {
      const botManager = getBotManager();
      if (!botManager?.enabled || typeof botManager.sendPlainAlert !== 'function') {
        return false;
      }

      const lines = [
        `One-UI Xray Update ${ok ? 'SUCCESS' : 'FAILED'}`,
        `stage=${stage}`,
        `channel=${channel}`,
        actor?.username ? `actor=${actor.username}` : null,
        summary ? `summary=${summary.split('\n')[0]}` : null
      ].filter(Boolean);

      await botManager.sendPlainAlert(lines.join('\n'));
      return true;
    } catch (error) {
      logger.error('Failed to notify Telegram about xray update', {
        message: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  async getPolicy() {
    const lastSuccessfulCanary = await this.findLastSuccessfulCanary();

    return {
      mode: this.updateMode,
      updatesEnabled: this.updatesEnabled,
      requireCanaryBeforeFull: this.requireCanary,
      canaryWindowMinutes: this.canaryWindowMinutes,
      defaultChannel: this.defaultChannel,
      updateTimeoutMs: this.updateTimeoutMs,
      canaryReady: Boolean(lastSuccessfulCanary),
      lastSuccessfulCanaryAt: lastSuccessfulCanary?.createdAt || null
    };
  }

  async findLastSuccessfulCanary() {
    const cutoff = new Date(Date.now() - this.canaryWindowMinutes * 60 * 1000);

    const logs = await prisma.systemLog.findMany({
      where: {
        message: {
          startsWith: `${UPDATE_LOG_PREFIX}: stage=canary status=success`
        },
        timestamp: {
          gte: cutoff
        }
      },
      orderBy: {
        timestamp: 'desc'
      },
      take: 1
    });

    return logs[0] || null;
  }

  async forceUnlock(actor = null, options = {}) {
    const normalizedReason = normalizeUnlockReason(options.reason);
    const force = normalizeForceUnlock(options.force);
    const existingLock = await workerLockService.get(this.updateLockName);

    if (!existingLock) {
      metrics.recordXrayUpdateRun({
        stage: 'unlock',
        status: 'noop'
      });
      metrics.setXrayUpdateLockState({ active: 0, stale: 0, ageSeconds: 0 });
      return {
        unlocked: false,
        hadLock: false,
        forced: false,
        stale: false,
        lockName: this.updateLockName,
        previousOwnerId: null,
        previousExpiresAt: null,
        reason: normalizedReason,
        message: 'No update lock exists.'
      };
    }

    const stale = existingLock.expiresAt.getTime() <= Date.now();
    if (!stale && !force) {
      this.setLockMetrics(existingLock);
      metrics.recordXrayUpdateRun({
        stage: 'unlock',
        status: 'blocked'
      });
      return {
        unlocked: false,
        hadLock: true,
        forced: false,
        stale: false,
        lockName: this.updateLockName,
        previousOwnerId: existingLock.ownerId,
        previousExpiresAt: existingLock.expiresAt.toISOString(),
        reason: normalizedReason,
        message: 'Lock is still active. Pass force=true to unlock an active lock.'
      };
    }
    const lockSignature = this.buildStuckLockSignature(existingLock);
    const released = await workerLockService.release(this.updateLockName, existingLock.ownerId);
    if (released) {
      this.clearStuckLockAlert(lockSignature);
    }

    const ok = Boolean(released);
    const logLevel = ok ? 'WARNING' : 'ERROR';
    const logMessage = `${UPDATE_LOG_PREFIX}: stage=unlock status=${ok ? 'success' : 'failed'} channel=n/a`;

    await this.logEvent({
      level: logLevel,
      message: logMessage,
      metadata: {
        lockName: this.updateLockName,
        stale,
        force,
        reason: normalizedReason,
        actorId: actor?.id || null,
        actorUsername: actor?.username || null,
        previousOwnerId: existingLock.ownerId,
        previousExpiresAt: existingLock.expiresAt.toISOString(),
        unlocked: ok
      }
    });
    metrics.recordXrayUpdateRun({
      stage: 'unlock',
      status: ok ? 'success' : 'failed'
    });
    if (ok) {
      metrics.setXrayUpdateLockState({ active: 0, stale: 0, ageSeconds: 0 });
    } else {
      this.setLockMetrics(existingLock);
    }

    return {
      unlocked: ok,
      hadLock: true,
      forced: force,
      stale,
      lockName: this.updateLockName,
      previousOwnerId: existingLock.ownerId,
      previousExpiresAt: existingLock.expiresAt.toISOString(),
      reason: normalizedReason,
      message: ok ? 'Update lock released.' : 'Failed to release update lock.'
    };
  }

  async runUpdate(input = {}, actor = null) {
    this.ensureScriptedUpdatesEnabled();

    const stage = this.normalizeStage(input.stage);
    const channel = stage === 'rollback' ? null : this.normalizeChannel(input.channel);
    const image = stage === 'rollback' ? null : this.normalizeImage(input.image);
    const noRollback = parseBoolean(input.noRollback, false);
    const force = parseBoolean(input.force, false);
    const backupTag = stage === 'rollback' ? normalizeBackupTag(input.backupTag) : null;
    const lockOwnerId = `${workerLockService.getDefaultOwnerId()}:xray-update:${crypto.randomBytes(6).toString('hex')}`;
    let hasLock = false;

    if (stage === 'full' && this.requireCanary && !force) {
      const lastCanary = await this.findLastSuccessfulCanary();
      if (!lastCanary) {
        throw new ValidationError('Full rollout requires a successful canary within policy window. Run canary first or set force=true.');
      }
    }

    const scriptPath = this.resolveScriptPath();
    if (!scriptPath) {
      throw new ValidationError('Xray update script not found. Set XRAY_UPDATE_SCRIPT to the absolute script path.');
    }
    if (!this.isExecutable(scriptPath)) {
      throw new ValidationError(`Xray update script is not executable: ${scriptPath}`);
    }

    const lockResult = await workerLockService.acquire(
      this.updateLockName,
      lockOwnerId,
      this.updateLockTtlSeconds,
      {
        stage,
        channel,
        actorId: actor?.id || null,
        actorUsername: actor?.username || null
      }
    );

    if (!lockResult.acquired) {
      await this.refreshLockMetrics();
      metrics.recordXrayUpdateRun({
        stage,
        status: 'blocked'
      });
      throw new ValidationError('Another Xray update task is running. Wait for it to finish before retrying.');
    }

    hasLock = true;
    const lockSignature = this.buildStuckLockSignature(lockResult.lock);
    this.setLockMetrics(lockResult.lock);

    try {
      const args = this.buildArgs({ channel, image, stage, noRollback, backupTag });
      const startedAt = new Date();
      const result = await this.executeScript(scriptPath, args);
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      const { summary, outputTail } = this.buildSummary(result);
      const ok = result.ok;
      const createdBackupTag = this.parseBackupTagFromOutput(result);
      const responseChannel = channel || this.defaultChannel;

      const logLevel = ok ? 'INFO' : 'ERROR';
      const logMessage = `${UPDATE_LOG_PREFIX}: stage=${stage} status=${ok ? 'success' : 'failed'} channel=${channel || 'n/a'}`;
      const telegramForwarded = await this.notifyTelegram({
        ok,
        stage,
        channel: channel || 'rollback',
        actor,
        summary
      });

      await this.logEvent({
        level: logLevel,
        message: logMessage,
        metadata: {
          stage,
          channel: responseChannel,
          image,
          backupTag,
          createdBackupTag,
          args: redactCliArgs(args),
          actorId: actor?.id || null,
          actorUsername: actor?.username || null,
          ok,
          durationMs,
          timedOut: Boolean(result.timedOut),
          exitCode: typeof result.code === 'number' ? result.code : null,
          signal: result.signal || null,
          summary,
          outputTail,
          telegramForwarded,
          lockName: this.updateLockName
        }
      });
      metrics.recordXrayUpdateRun({
        stage,
        status: ok ? 'success' : 'failed'
      });

      if (!ok) {
        const failureMessage = result.timedOut
          ? `Xray update timed out after ${Math.round(this.updateTimeoutMs / 1000)}s`
          : (result.stderr || result.stdout || 'Xray update failed');
        throw new ValidationError(failureMessage);
      }

      return {
        ok: true,
        stage,
        channel: responseChannel,
        image,
        backupTag,
        createdBackupTag,
        durationMs,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        summary,
        outputTail,
        telegramForwarded
      };
    } finally {
      if (hasLock) {
        try {
          const released = await workerLockService.release(this.updateLockName, lockOwnerId);
          if (released) {
            this.clearStuckLockAlert(lockSignature);
            metrics.setXrayUpdateLockState({ active: 0, stale: 0, ageSeconds: 0 });
          } else {
            await this.refreshLockMetrics();
          }
        } catch (error) {
          await this.refreshLockMetrics();
          logger.error('Failed to release xray update lock', {
            message: error.message,
            stack: error.stack,
            lockName: this.updateLockName,
            ownerId: lockOwnerId
          });
        }
      }
    }
  }

  async listBackups() {
    if (!this.updatesEnabled) {
      return [];
    }

    this.ensureScriptedUpdatesEnabled();

    const scriptPath = this.resolveScriptPath();
    if (!scriptPath) {
      throw new ValidationError('Xray update script not found. Set XRAY_UPDATE_SCRIPT to the absolute script path.');
    }

    const result = await this.executeScript(scriptPath, ['--list-backups']);
    if (!result.ok) {
      throw new ValidationError(result.stderr || result.stdout || 'Unable to list backup tags');
    }

    const backups = (result.stdout || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^oneui-xray-backup:[A-Za-z0-9_.-]+$/.test(line));

    return backups;
  }

  async listHistory({ page = 1, limit = 20 } = {}) {
    const safePage = parsePositiveInt(page, 1, 1, 10_000);
    const safeLimit = parsePositiveInt(limit, 20, 1, 200);
    const skip = (safePage - 1) * safeLimit;

    const where = {
      message: {
        startsWith: UPDATE_LOG_PREFIX
      }
    };

    const [rows, total] = await Promise.all([
      prisma.systemLog.findMany({
        where,
        orderBy: {
          timestamp: 'desc'
        },
        skip,
        take: safeLimit
      }),
      prisma.systemLog.count({ where })
    ]);

    const items = rows.map((row) => ({
      id: row.id,
      level: row.level,
      message: row.message,
      metadata: row.metadata || null,
      timestamp: row.timestamp
    }));

    return {
      items,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(1, Math.ceil(total / safeLimit))
      }
    };
  }
}

module.exports = new XrayUpdateService();
