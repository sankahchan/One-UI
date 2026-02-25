const fs = require('fs/promises');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const logger = require('../config/logger');
const { getBotManager } = require('../telegram/bot');
const { ValidationError } = require('../utils/errors');

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

function normalizeMode(value, fallback = 'docker') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'manual') {
    return 'manual';
  }
  if (normalized === 'docker') {
    return 'docker';
  }
  return fallback;
}

function sanitizeMultiline(text, maxLength = 1200) {
  if (!text) {
    return '';
  }
  return String(text).replace(/\s+$/g, '').slice(0, maxLength);
}

function normalizeLineCount(value, fallback = 120) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 10), 500);
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

function parseVersionText(output = '') {
  if (!output) {
    return null;
  }

  const line = String(output)
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  if (!line) {
    return null;
  }

  const versionMatch = line.match(/v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?/i);
  if (versionMatch) {
    return versionMatch[0];
  }

  return line.slice(0, 120);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

class MieruRuntimeService {
  constructor() {
    this.enabled = parseBoolean(process.env.MIERU_ENABLED, false);
    this.mode = normalizeMode(process.env.MIERU_RUNTIME_MODE, 'docker');

    this.containerName = String(process.env.MIERU_CONTAINER_NAME || 'mieru-sidecar').trim() || 'mieru-sidecar';
    this.composeServiceName = String(process.env.MIERU_SERVICE_NAME || 'mieru').trim() || 'mieru';
    this.composeFilePath = String(process.env.MIERU_COMPOSE_FILE || process.env.COMPOSE_FILE || '/opt/one-ui/docker-compose.yml').trim();

    this.healthUrl = String(process.env.MIERU_HEALTH_URL || '').trim();
    this.commandTimeoutMs = parsePositiveInt(process.env.MIERU_COMMAND_TIMEOUT_MS, 7000, 1000, 120000);

    this.manualVersionCommand = String(process.env.MIERU_VERSION_COMMAND || 'mita version || mieru version').trim();
    this.manualRestartCommand = String(process.env.MIERU_RESTART_COMMAND || '').trim();
    this.manualLogPath = String(process.env.MIERU_LOG_PATH || '').trim();
    this.configPath = String(process.env.MIERU_CONFIG_PATH || '/opt/one-ui/mieru/server_config.json').trim();

    this.restartAlertThreshold = parsePositiveInt(process.env.MIERU_RESTART_ALERT_THRESHOLD, 3, 1, 1000);
    this.restartAlertWindowMs = parsePositiveInt(process.env.MIERU_RESTART_ALERT_WINDOW_SECONDS, 600, 60, 86_400) * 1000;
    this.restartAlertCooldownMs = parsePositiveInt(process.env.MIERU_RESTART_ALERT_COOLDOWN_SECONDS, 900, 60, 86_400) * 1000;

    this.startupGuardCompleted = false;
    this.startupGuardPromise = null;
    this.restartWindowState = null;
  }

  getPolicy() {
    return {
      enabled: this.enabled,
      mode: this.mode,
      containerName: this.containerName,
      composeServiceName: this.composeServiceName,
      composeFilePath: this.composeFilePath,
      healthUrl: this.healthUrl || null,
      configPath: this.configPath || null,
      manualRestartCommandConfigured: Boolean(this.manualRestartCommand),
      manualLogPathConfigured: Boolean(this.manualLogPath),
      restartAlertThreshold: this.restartAlertThreshold,
      restartAlertWindowSeconds: Math.floor(this.restartAlertWindowMs / 1000),
      restartAlertCooldownSeconds: Math.floor(this.restartAlertCooldownMs / 1000)
    };
  }

  runCommand(command, args = [], timeoutMs = this.commandTimeoutMs) {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill('SIGKILL');
        resolve({
          ok: false,
          code: null,
          timedOut: true,
          stdout,
          stderr: stderr || `Command timed out after ${timeoutMs}ms`
        });
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: false,
          code: null,
          timedOut: false,
          stdout,
          stderr: error.message
        });
      });

      child.on('close', (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: code === 0,
          code,
          timedOut: false,
          stdout,
          stderr
        });
      });
    });
  }

  async writeConfigAtomically(content) {
    const directory = path.dirname(this.configPath);
    await fs.mkdir(directory, { recursive: true });
    const tempPath = `${this.configPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, this.configPath);
  }

  async stripLegacySyncMetadataFromConfig() {
    if (!this.configPath) {
      return {
        ok: false,
        changed: false,
        checkedAt: new Date().toISOString(),
        detail: 'MIERU_CONFIG_PATH is not configured.'
      };
    }

    let parsed = {};
    let existed = false;
    try {
      const raw = await fs.readFile(this.configPath, 'utf8');
      existed = true;
      parsed = JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
          ok: true,
          changed: false,
          checkedAt: new Date().toISOString(),
          detail: `Mieru config not found at ${this.configPath}`
        };
      }
      return {
        ok: false,
        changed: false,
        checkedAt: new Date().toISOString(),
        detail: sanitizeMultiline(error.message || 'Unable to read Mieru config', 280)
      };
    }

    if (!isPlainObject(parsed) || !Object.prototype.hasOwnProperty.call(parsed, 'oneUiSync')) {
      return {
        ok: true,
        changed: false,
        checkedAt: new Date().toISOString(),
        detail: existed ? 'Mieru config is already clean.' : 'Mieru config not found.'
      };
    }

    delete parsed.oneUiSync;
    await this.writeConfigAtomically(`${JSON.stringify(parsed, null, 2)}\n`);
    return {
      ok: true,
      changed: true,
      checkedAt: new Date().toISOString(),
      detail: 'Removed legacy oneUiSync metadata from Mieru runtime config.'
    };
  }

  async runStartupGuard({ force = false } = {}) {
    if (this.startupGuardCompleted && !force) {
      return {
        ok: true,
        changed: false,
        checkedAt: new Date().toISOString(),
        detail: 'Startup guard already completed.'
      };
    }

    if (this.startupGuardPromise && !force) {
      return this.startupGuardPromise;
    }

    this.startupGuardPromise = (async () => {
      const result = await this.stripLegacySyncMetadataFromConfig();
      if (result.ok) {
        this.startupGuardCompleted = true;
      } else {
        this.startupGuardCompleted = false;
        logger.warn('Mieru startup guard could not sanitize runtime config', {
          action: 'mieru_startup_guard',
          configPath: this.configPath,
          detail: result.detail
        });
      }

      if (result.changed) {
        logger.warn('Mieru startup guard removed legacy runtime metadata', {
          action: 'mieru_startup_guard',
          configPath: this.configPath
        });
      }

      return result;
    })()
      .catch((error) => {
        this.startupGuardCompleted = false;
        const detail = sanitizeMultiline(error.message || 'Mieru startup guard failed', 280);
        logger.warn('Mieru startup guard failed', {
          action: 'mieru_startup_guard',
          configPath: this.configPath,
          detail
        });
        return {
          ok: false,
          changed: false,
          checkedAt: new Date().toISOString(),
          detail
        };
      })
      .finally(() => {
        this.startupGuardPromise = null;
      });

    return this.startupGuardPromise;
  }

  async probeHealth() {
    if (!this.healthUrl) {
      return {
        configured: false,
        ok: null,
        statusCode: null,
        latencyMs: null,
        error: null
      };
    }

    const started = Date.now();
    const timeoutMs = Math.min(this.commandTimeoutMs, 10000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(this.healthUrl, {
        method: 'GET',
        signal: controller.signal
      });

      return {
        configured: true,
        ok: response.ok,
        statusCode: response.status,
        latencyMs: Date.now() - started,
        error: null
      };
    } catch (error) {
      return {
        configured: true,
        ok: false,
        statusCode: null,
        latencyMs: Date.now() - started,
        error: sanitizeMultiline(error.message || 'Health probe failed', 240)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async readTailFromFile(filePath, lineCount) {
    const content = await fs.readFile(filePath, 'utf8');
    const rows = content.split('\n');
    const lines = rows.slice(Math.max(0, rows.length - lineCount));
    return lines.join('\n').trim();
  }

  buildRestartMonitor(containerState) {
    if (!containerState?.exists || !Number.isInteger(containerState.restartCount) || containerState.restartCount < 0) {
      this.restartWindowState = null;
      return null;
    }

    const nowMs = Date.now();
    const currentRestartCount = containerState.restartCount;
    let state = this.restartWindowState;

    if (!state) {
      state = {
        windowStartedAtMs: nowMs,
        baselineRestartCount: currentRestartCount,
        lastRestartCount: currentRestartCount,
        lastAlertAtMs: 0
      };
    } else {
      if (currentRestartCount < state.lastRestartCount) {
        state.windowStartedAtMs = nowMs;
        state.baselineRestartCount = currentRestartCount;
        state.lastRestartCount = currentRestartCount;
        state.lastAlertAtMs = 0;
      }

      if (nowMs - state.windowStartedAtMs > this.restartAlertWindowMs) {
        state.windowStartedAtMs = nowMs;
        state.baselineRestartCount = currentRestartCount;
      }

      state.lastRestartCount = currentRestartCount;
    }

    const observedRestarts = Math.max(0, currentRestartCount - state.baselineRestartCount);
    const alerting = observedRestarts >= this.restartAlertThreshold;
    const canAlert = alerting && (state.lastAlertAtMs === 0 || nowMs - state.lastAlertAtMs >= this.restartAlertCooldownMs);

    this.restartWindowState = state;

    return {
      restartCount: currentRestartCount,
      observedRestarts,
      threshold: this.restartAlertThreshold,
      windowSeconds: Math.floor(this.restartAlertWindowMs / 1000),
      cooldownSeconds: Math.floor(this.restartAlertCooldownMs / 1000),
      alerting,
      canAlert,
      windowStartedAt: new Date(state.windowStartedAtMs).toISOString(),
      lastAlertAt: state.lastAlertAtMs ? new Date(state.lastAlertAtMs).toISOString() : null
    };
  }

  async emitRestartAlertIfNeeded(restartMonitor) {
    if (!restartMonitor?.canAlert || !this.restartWindowState) {
      return;
    }

    this.restartWindowState.lastAlertAtMs = Date.now();
    const lines = [
      'One-UI Mieru Restart Alert',
      `container=${this.containerName}`,
      `restarts_in_window=${restartMonitor.observedRestarts}`,
      `threshold=${restartMonitor.threshold}`,
      `window=${restartMonitor.windowSeconds}s`,
      `total_restart_count=${restartMonitor.restartCount}`
    ];

    logger.warn('Mieru restart threshold exceeded', {
      action: 'mieru_restart_alert',
      containerName: this.containerName,
      observedRestarts: restartMonitor.observedRestarts,
      threshold: restartMonitor.threshold,
      windowSeconds: restartMonitor.windowSeconds,
      restartCount: restartMonitor.restartCount
    });

    try {
      const botManager = getBotManager();
      if (botManager?.enabled && typeof botManager.sendPlainAlert === 'function') {
        await botManager.sendPlainAlert(lines.join('\n'));
      }
    } catch (error) {
      logger.error('Failed to send Mieru restart alert', {
        action: 'mieru_restart_alert',
        containerName: this.containerName,
        message: error.message
      });
    }
  }

  async getDockerContainerState() {
    if (!detectDockerAvailable()) {
      return {
        dockerAvailable: false,
        exists: false,
        running: false,
        restarting: false,
        state: 'docker-unavailable',
        image: null,
        detail: 'Docker daemon unavailable'
      };
    }

    const inspectResult = await this.runCommand('docker', [
      'inspect',
      '--format',
      '{{json .State}}|{{.Config.Image}}|{{.RestartCount}}',
      this.containerName
    ]);

    if (!inspectResult.ok) {
      const notFound = /No such object/i.test(inspectResult.stderr || '');
      return {
        dockerAvailable: true,
        exists: false,
        running: false,
        restarting: false,
        state: notFound ? 'not-found' : 'inspect-failed',
        image: null,
        detail: sanitizeMultiline(inspectResult.stderr || inspectResult.stdout || 'Failed to inspect Mieru container', 320)
      };
    }

    const [stateJson = '{}', image = '', restartCountRaw = '0'] = String(inspectResult.stdout).trim().split('|');

    let parsedState = {};
    try {
      parsedState = JSON.parse(stateJson);
    } catch (_error) {
      parsedState = {};
    }

    const running = Boolean(parsedState.Running);
    const restarting = Boolean(parsedState.Restarting);
    const state = String(parsedState.Status || '').trim() || (running ? 'running' : 'stopped');
    const restartCount = Number.parseInt(String(restartCountRaw || '0').trim(), 10);

    return {
      dockerAvailable: true,
      exists: true,
      running,
      restarting,
      state,
      image: image || null,
      restartCount: Number.isInteger(restartCount) && restartCount >= 0 ? restartCount : 0,
      detail: null
    };
  }

  async resolveDockerVersion(containerState) {
    if (!containerState.exists || !containerState.running) {
      return null;
    }

    const candidates = [
      ['exec', this.containerName, 'mita', 'version'],
      ['exec', this.containerName, 'mita', '--version'],
      ['exec', this.containerName, 'mieru', 'version'],
      ['exec', this.containerName, 'mieru', '--version'],
      ['exec', this.containerName, '/usr/local/bin/mita', 'version'],
      ['exec', this.containerName, '/usr/bin/mita', 'version'],
      ['exec', this.containerName, '/usr/local/bin/mieru', 'version'],
      ['exec', this.containerName, '/usr/bin/mieru', 'version']
    ];

    for (const args of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const result = await this.runCommand('docker', args);
      if (!result.ok) {
        continue;
      }

      const parsed = parseVersionText(result.stdout || result.stderr);
      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  async resolveManualVersion() {
    if (!this.manualVersionCommand) {
      return null;
    }

    const result = await this.runCommand('sh', ['-lc', this.manualVersionCommand]);
    if (!result.ok) {
      return null;
    }

    return parseVersionText(result.stdout || result.stderr);
  }

  async getStatus() {
    await this.runStartupGuard();

    if (!this.enabled) {
      return {
        ...this.getPolicy(),
        running: false,
        state: 'disabled',
        version: null,
        restartMonitor: null,
        health: {
          configured: Boolean(this.healthUrl),
          ok: null,
          statusCode: null,
          latencyMs: null,
          error: null
        },
        checkedAt: new Date().toISOString(),
        detail: 'Mieru sidecar integration is disabled'
      };
    }

    if (this.mode === 'manual') {
      const [version, health] = await Promise.all([
        this.resolveManualVersion(),
        this.probeHealth()
      ]);

      return {
        ...this.getPolicy(),
        dockerAvailable: false,
        running: health.ok === true,
        state: health.ok === true ? 'running' : 'unknown',
        version,
        restartMonitor: null,
        health,
        checkedAt: new Date().toISOString(),
        detail: health.ok === true
          ? 'Manual mode active (status from configured health endpoint).'
          : 'Manual mode active. Configure MIERU_HEALTH_URL and MIERU_RESTART_COMMAND for full control-plane actions.'
      };
    }

    const [containerState, health] = await Promise.all([
      this.getDockerContainerState(),
      this.probeHealth()
    ]);
    const version = await this.resolveDockerVersion(containerState);
    const restartMonitor = this.buildRestartMonitor(containerState);
    await this.emitRestartAlertIfNeeded(restartMonitor);

    return {
      ...this.getPolicy(),
      dockerAvailable: containerState.dockerAvailable,
      running: containerState.running,
      state: containerState.state,
      restarting: containerState.restarting,
      image: containerState.image,
      restartMonitor,
      version,
      health,
      checkedAt: new Date().toISOString(),
      detail: containerState.detail
    };
  }

  async restart() {
    if (!this.enabled) {
      throw new ValidationError('Mieru integration is disabled. Set MIERU_ENABLED=true first.');
    }

    await this.runStartupGuard();

    if (this.mode === 'manual') {
      if (!this.manualRestartCommand) {
        throw new ValidationError('MIERU_RESTART_COMMAND is required in manual mode.');
      }

      const manualRestart = await this.runCommand('sh', ['-lc', this.manualRestartCommand], Math.max(this.commandTimeoutMs, 20000));
      if (!manualRestart.ok) {
        throw new ValidationError(
          sanitizeMultiline(manualRestart.stderr || manualRestart.stdout || 'Failed to restart Mieru in manual mode', 360)
        );
      }

      const status = await this.getStatus();
      return {
        success: true,
        message: 'Mieru restart command executed (manual mode).',
        status
      };
    }

    if (!detectDockerAvailable()) {
      throw new ValidationError('Docker daemon is unavailable. Cannot restart Mieru sidecar.');
    }

    let restartResult = null;

    const composeArgs = this.composeFilePath
      ? ['compose', '-f', this.composeFilePath, 'restart', this.composeServiceName]
      : [];

    if (composeArgs.length > 0) {
      restartResult = await this.runCommand('docker', composeArgs, Math.max(this.commandTimeoutMs, 20000));
    }

    if (!restartResult || !restartResult.ok) {
      const fallbackResult = await this.runCommand('docker', ['restart', this.containerName], Math.max(this.commandTimeoutMs, 20000));
      if (!fallbackResult.ok) {
        const detail = sanitizeMultiline(
          fallbackResult.stderr
            || fallbackResult.stdout
            || restartResult?.stderr
            || restartResult?.stdout
            || 'Failed to restart Mieru sidecar',
          360
        );
        throw new ValidationError(detail);
      }
    }

    const status = await this.getStatus();

    return {
      success: true,
      message: 'Mieru sidecar restarted successfully.',
      status
    };
  }

  async getLogs(lineCount = 120) {
    const lines = normalizeLineCount(lineCount, 120);

    if (!this.enabled) {
      return {
        enabled: false,
        source: null,
        lines,
        raw: '',
        detail: 'Mieru integration is disabled.'
      };
    }

    if (this.mode === 'manual') {
      if (!this.manualLogPath) {
        return {
          enabled: true,
          source: 'manual',
          lines,
          raw: '',
          detail: 'MIERU_LOG_PATH is not configured.'
        };
      }

      try {
        const raw = await this.readTailFromFile(this.manualLogPath, lines);
        return {
          enabled: true,
          source: 'file',
          lines,
          raw,
          detail: this.manualLogPath
        };
      } catch (error) {
        logger.warn('Failed to read Mieru log file', {
          filePath: this.manualLogPath,
          message: error.message
        });
        return {
          enabled: true,
          source: 'file',
          lines,
          raw: '',
          detail: sanitizeMultiline(error.message || 'Failed to read Mieru log file', 300)
        };
      }
    }

    const result = await this.runCommand('docker', ['logs', `--tail=${lines}`, this.containerName], Math.max(this.commandTimeoutMs, 15000));
    const combined = [result.stdout, result.stderr]
      .filter((entry) => entry && entry.trim().length > 0)
      .join('\n')
      .trim();

    return {
      enabled: true,
      source: 'docker',
      lines,
      raw: combined,
      detail: result.ok ? null : sanitizeMultiline(combined || 'Unable to read Mieru logs', 320)
    };
  }
}

module.exports = new MieruRuntimeService();
