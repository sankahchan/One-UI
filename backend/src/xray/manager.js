const { exec } = require('child_process');
const util = require('util');
const fs = require('node:fs').promises;
const path = require('node:path');

const configGenerator = require('./config-generator');
const logger = require('../config/logger');

const execPromise = util.promisify(exec);

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return ['1', 'true', 'yes', 'on', 'y'].includes(String(value).trim().toLowerCase());
}

function parsePositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function normalizeDeploymentHint(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  if (['docker', 'container', 'compose'].includes(normalized)) {
    return 'docker';
  }
  if (['systemd', 'service'].includes(normalized)) {
    return 'systemd';
  }
  if (['local', 'process', 'manual', 'binary'].includes(normalized)) {
    return 'local';
  }
  return null;
}

class XrayManager {
  constructor() {
    this.xrayBinary = process.env.XRAY_BINARY || process.env.XRAY_BINARY_PATH || '/usr/local/bin/xray';
    this.configPath = process.env.XRAY_CONFIG_PATH || '/etc/xray/config.json';
    this.pidFile = process.env.XRAY_PID_FILE || process.env.XRAY_PID_PATH || '/var/run/xray.pid';
    this.confDirPath = process.env.XRAY_CONF_DIR || '/etc/xray/conf.d';
    this.confDirEnabled = parseBoolean(process.env.XRAY_WRITE_CONFDIR, false);
    this.hotReloadEnabled = parseBoolean(process.env.XRAY_HOT_RELOAD_ENABLED, true);
    this.snapshotDir = process.env.XRAY_CONFIG_SNAPSHOT_DIR || path.join(path.dirname(this.configPath), 'snapshots');
    this.snapshotRetention = parsePositiveInt(process.env.XRAY_CONFIG_SNAPSHOT_RETENTION, 20, 1, 500);
  }

  async hasCommand(command) {
    try {
      await execPromise(`command -v ${command} >/dev/null 2>&1`);
      return true;
    } catch (_error) {
      return false;
    }
  }

  getDeploymentHint() {
    return normalizeDeploymentHint(process.env.XRAY_DEPLOYMENT);
  }

  async inspectDockerContainer(containerName = 'xray-core') {
    if (!(await this.hasCommand('docker'))) {
      return {
        source: 'docker',
        available: false,
        exists: false,
        running: false,
        state: 'unavailable',
        containerName
      };
    }

    try {
      const { stdout } = await execPromise(
        `docker inspect -f '{{.State.Running}}|{{.State.Status}}|{{.State.StartedAt}}' ${containerName}`
      );
      const [runningRaw = 'false', stateRaw = 'unknown', startedAtRaw = ''] = stdout.trim().split('|');

      return {
        source: 'docker',
        available: true,
        exists: true,
        running: runningRaw.trim() === 'true',
        state: stateRaw.trim().toLowerCase() || 'unknown',
        startedAt: startedAtRaw.trim() || null,
        containerName
      };
    } catch (error) {
      const diagnostic = String(error?.stderr || error?.stdout || error?.message || '').toLowerCase();
      const missing = diagnostic.includes('no such object') || diagnostic.includes('not found');

      return {
        source: 'docker',
        available: true,
        exists: false,
        running: false,
        state: missing ? 'missing' : 'unknown',
        containerName
      };
    }
  }

  async inspectSystemdService(serviceName = 'xray') {
    if (!(await this.hasCommand('systemctl'))) {
      return {
        source: 'systemd',
        available: false,
        exists: false,
        running: false,
        state: 'unavailable',
        serviceName
      };
    }

    try {
      const { stdout } = await execPromise(`systemctl is-active ${serviceName} 2>/dev/null || true`);
      const state = String(stdout || '').trim().toLowerCase();
      const knownStates = ['active', 'inactive', 'failed', 'activating', 'deactivating', 'reloading', 'unknown'];
      const normalizedState = knownStates.includes(state) ? state : 'unknown';

      return {
        source: 'systemd',
        available: true,
        exists: normalizedState !== 'unknown',
        running: normalizedState === 'active',
        state: normalizedState,
        serviceName
      };
    } catch (_error) {
      return {
        source: 'systemd',
        available: true,
        exists: false,
        running: false,
        state: 'unknown',
        serviceName
      };
    }
  }

  async inspectLocalProcess() {
    const pidExists = await fs.access(this.pidFile).then(() => true).catch(() => false);
    if (!pidExists) {
      return {
        source: 'local',
        available: true,
        exists: false,
        running: false,
        state: 'missing-pid',
        pidFile: this.pidFile
      };
    }

    try {
      const pid = (await fs.readFile(this.pidFile, 'utf8')).trim();
      if (!/^\d+$/.test(pid)) {
        return {
          source: 'local',
          available: true,
          exists: true,
          running: false,
          state: 'invalid-pid',
          pidFile: this.pidFile
        };
      }

      const { stdout } = await execPromise(`ps -p ${pid} -o comm=`);
      const running = String(stdout || '').toLowerCase().includes('xray');

      return {
        source: 'local',
        available: true,
        exists: true,
        running,
        state: running ? 'running' : 'stale-pid',
        pidFile: this.pidFile
      };
    } catch (_error) {
      return {
        source: 'local',
        available: true,
        exists: true,
        running: false,
        state: 'stale-pid',
        pidFile: this.pidFile
      };
    }
  }

  selectRuntimeSource(details, deploymentHint = null) {
    const priorityByHint = {
      docker: ['docker', 'systemd', 'local'],
      systemd: ['systemd', 'docker', 'local'],
      local: ['local', 'docker', 'systemd']
    };
    const priority = priorityByHint[deploymentHint] || ['docker', 'systemd', 'local'];

    for (const source of priority) {
      const detail = details[source];
      if (!detail) {
        continue;
      }

      if (source === 'local') {
        if (detail.running || detail.exists) {
          return source;
        }
        continue;
      }

      if (detail.available && (detail.running || detail.exists)) {
        return source;
      }
    }

    if (deploymentHint && details[deploymentHint]) {
      return deploymentHint;
    }

    return 'local';
  }

  async resolveRuntimeStatus() {
    const deploymentHint = this.getDeploymentHint();
    const [docker, systemd, local] = await Promise.all([
      this.inspectDockerContainer('xray-core'),
      this.inspectSystemdService('xray'),
      this.inspectLocalProcess()
    ]);
    const details = { docker, systemd, local };
    const source = this.selectRuntimeSource(details, deploymentHint);
    const selected = details[source] || details.local || {
      running: false,
      state: 'unknown'
    };
    const mode = source || deploymentHint || 'local';

    return {
      mode,
      source,
      running: Boolean(selected.running),
      state: selected.state || (selected.running ? 'running' : 'unknown'),
      deploymentHint: deploymentHint || 'auto',
      hintMismatch: Boolean(deploymentHint && mode !== deploymentHint),
      details
    };
  }

  async isDockerContainerRunning(containerName = 'xray-core') {
    const status = await this.inspectDockerContainer(containerName);
    return status.running;
  }

  async readCurrentConfigRaw() {
    try {
      return await fs.readFile(this.configPath, 'utf8');
    } catch (_error) {
      return null;
    }
  }

  async restoreConfig(rawConfig) {
    if (typeof rawConfig !== 'string') {
      return;
    }

    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, rawConfig, 'utf8');
  }

  sanitizeSnapshotId(snapshotId) {
    const value = String(snapshotId || '').trim();
    if (!/^[a-zA-Z0-9._-]{6,120}$/.test(value)) {
      throw new Error('Invalid snapshot ID');
    }
    return value;
  }

  async ensureSnapshotDir() {
    try {
      await fs.mkdir(this.snapshotDir, { recursive: true });
    } catch (error) {
      if (error?.code !== 'EACCES' && error?.code !== 'EPERM') {
        throw error;
      }

      const fallbackDir = path.resolve(process.cwd(), 'runtime', 'xray-snapshots');
      logger.warn('Snapshot directory is not writable; using fallback runtime directory', {
        snapshotDir: this.snapshotDir,
        fallbackDir
      });

      this.snapshotDir = fallbackDir;
      await fs.mkdir(this.snapshotDir, { recursive: true });
    }
  }

  async pruneSnapshots() {
    try {
      const entries = await fs.readdir(this.snapshotDir);
      const snapshotIds = entries
        .filter((name) => name.endsWith('.config.json'))
        .map((name) => name.replace('.config.json', ''))
        .sort()
        .reverse();
      const stale = snapshotIds.slice(this.snapshotRetention);
      for (const id of stale) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.all([
          fs.rm(path.join(this.snapshotDir, `${id}.config.json`), { force: true }),
          fs.rm(path.join(this.snapshotDir, `${id}.meta.json`), { force: true })
        ]);
      }
    } catch (_error) {
      // best-effort cleanup
    }
  }

  async createSnapshotFromRaw(rawConfig, metadata = {}) {
    if (typeof rawConfig !== 'string' || rawConfig.trim() === '') {
      return null;
    }

    await this.ensureSnapshotDir();
    const snapshotId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
    const configFile = path.join(this.snapshotDir, `${snapshotId}.config.json`);
    const metaFile = path.join(this.snapshotDir, `${snapshotId}.meta.json`);
    const payload = {
      id: snapshotId,
      createdAt: new Date().toISOString(),
      configPath: this.configPath,
      ...metadata
    };

    await fs.writeFile(configFile, rawConfig, 'utf8');
    await fs.writeFile(metaFile, JSON.stringify(payload, null, 2), 'utf8');
    await this.pruneSnapshots();

    return payload;
  }

  async createCurrentSnapshot(reason = 'manual') {
    const currentRaw = await this.readCurrentConfigRaw();
    return this.createSnapshotFromRaw(currentRaw, { reason });
  }

  async listSnapshots(limit = 50) {
    await this.ensureSnapshotDir();
    const files = await fs.readdir(this.snapshotDir);
    const snapshotIds = files
      .filter((name) => name.endsWith('.config.json'))
      .map((name) => name.replace('.config.json', ''))
      .sort()
      .reverse()
      .slice(0, parsePositiveInt(limit, 50, 1, 200));

    const snapshots = [];
    for (const snapshotId of snapshotIds) {
      const metaPath = path.join(this.snapshotDir, `${snapshotId}.meta.json`);
      const configPath = path.join(this.snapshotDir, `${snapshotId}.config.json`);
      let metadata = {
        id: snapshotId,
        createdAt: null,
        reason: null
      };
      try {
        // eslint-disable-next-line no-await-in-loop
        const rawMeta = await fs.readFile(metaPath, 'utf8');
        metadata = { ...metadata, ...JSON.parse(rawMeta) };
      } catch (_error) {
        // keep fallback metadata
      }

      try {
        // eslint-disable-next-line no-await-in-loop
        const stat = await fs.stat(configPath);
        snapshots.push({
          ...metadata,
          size: stat.size
        });
      } catch (_error) {
        // file disappeared; skip
      }
    }

    return {
      directory: this.snapshotDir,
      snapshots
    };
  }

  async restartProcess() {
    const runtime = await this.resolveRuntimeStatus();

    if (runtime.mode === 'systemd') {
      await execPromise('systemctl restart xray');
      return;
    }

    if (runtime.mode === 'docker') {
      await execPromise('docker restart xray-core');
      return;
    }

    await this.stop();
    await this.start();
  }

  async hotReloadProcess() {
    const runtime = await this.resolveRuntimeStatus();

    if (runtime.mode === 'systemd') {
      await execPromise('systemctl reload xray');
      return;
    }

    if (runtime.mode === 'docker') {
      if (!runtime.running) {
        throw new Error('Xray docker runtime is not running');
      }
      await execPromise('docker kill --signal HUP xray-core');
      return;
    }

    const pid = (await fs.readFile(this.pidFile, 'utf8')).trim();
    if (!/^\d+$/.test(pid)) {
      throw new Error(`Invalid PID value in pid file: ${pid}`);
    }
    await execPromise(`kill -HUP ${pid}`);
  }

  async verifyRunning(retries = 6, delayMs = 1000) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const status = await this.getStatus();
      if (status.running) {
        return true;
      }

      if (attempt < retries - 1) {
        await new Promise((resolve) => {
          setTimeout(resolve, delayMs);
        });
      }
    }

    return false;
  }

  async applyRuntimeChange(method = 'hot') {
    const normalizedMethod = String(method || 'hot').toLowerCase();
    if (normalizedMethod === 'none') {
      return {
        requestedMethod: normalizedMethod,
        effectiveMethod: 'none',
        fallbackUsed: false
      };
    }

    if (normalizedMethod === 'hot') {
      if (!this.hotReloadEnabled) {
        await this.restartProcess();
        return {
          requestedMethod: 'hot',
          effectiveMethod: 'restart',
          fallbackUsed: true
        };
      }

      try {
        await this.hotReloadProcess();
        const running = await this.verifyRunning();
        if (!running) {
          throw new Error('Xray process did not report healthy after hot reload');
        }
        return {
          requestedMethod: 'hot',
          effectiveMethod: 'hot',
          fallbackUsed: false
        };
      } catch (error) {
        logger.warn('Hot reload failed, falling back to restart', {
          message: error.message
        });
        await this.restartProcess();
        const running = await this.verifyRunning();
        if (!running) {
          throw new Error('Xray failed to reach healthy running state after restart fallback');
        }
        return {
          requestedMethod: 'hot',
          effectiveMethod: 'restart',
          fallbackUsed: true
        };
      }
    }

    if (normalizedMethod === 'restart') {
      await this.restartProcess();
      const running = await this.verifyRunning();
      if (!running) {
        throw new Error('Xray failed to reach healthy running state after restart');
      }
      return {
        requestedMethod: 'restart',
        effectiveMethod: 'restart',
        fallbackUsed: false
      };
    }

    throw new Error('Invalid apply method');
  }

  async applyGeneratedConfig({ applyMethod = 'hot', createSnapshot = true } = {}) {
    const previousConfigRaw = await this.readCurrentConfigRaw();
    let generatedConfig = null;
    let snapshot = null;

    try {
      if (createSnapshot) {
        snapshot = await this.createSnapshotFromRaw(previousConfigRaw, {
          reason: 'before-apply'
        });
      }

      generatedConfig = await configGenerator.generateConfig();
      await configGenerator.saveConfig(generatedConfig);
      let confDir = null;
      if (this.confDirEnabled) {
        confDir = await configGenerator.saveConfigDirectory(generatedConfig, this.confDirPath);
      }

      const testResult = await this.testConfig();
      if (!testResult.valid) {
        throw new Error(`Config validation failed: ${testResult.error}`);
      }

      const apply = await this.applyRuntimeChange(applyMethod);

      // Trigger automatic firewall sync securely within xray-core's NET_ADMIN footprint
      try {
        const runtime = await this.resolveRuntimeStatus();
        if (runtime.mode === 'docker') {
          logger.info('Syncing host firewall rules via xray-core container...');
          await execPromise('docker exec xray-core sh /usr/local/bin/sync-firewall.sh');
          logger.info('Host firewall synchronized successfully.');
        } else {
          logger.info('Executing firewall sync script directly on local host...');
          await execPromise('sh /opt/one-ui/scripts/sync-firewall.sh || sh ../scripts/sync-firewall.sh || true');
        }
      } catch (fwError) {
        logger.warn('Failed to sync iptables firewall rules (this is safe to ignore if running locally without root)', {
          message: fwError.message
        });
      }

      return {
        config: generatedConfig,
        apply,
        snapshot,
        confDir
      };
    } catch (error) {
      logger.error('Xray apply failed, rolling back config', {
        message: error.message,
        stack: error.stack
      });

      if (previousConfigRaw !== null) {
        try {
          await this.restoreConfig(previousConfigRaw);
          await this.applyRuntimeChange(applyMethod === 'none' ? 'none' : 'restart');
          logger.warn('Xray config rolled back to previous known-good snapshot');
        } catch (rollbackError) {
          logger.error('Failed to roll back Xray config', {
            message: rollbackError.message,
            stack: rollbackError.stack
          });
        }
      }

      throw error;
    }
  }

  async restart() {
    try {
      const result = await this.applyGeneratedConfig({ applyMethod: 'restart' });
      logger.info('Xray restarted successfully');
      return {
        success: true,
        message: 'Xray restarted successfully',
        apply: result.apply
      };
    } catch (error) {
      logger.error('Failed to restart Xray', {
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async start() {
    try {
      // Start xray in the background and capture its PID into the pid file so
      // that stop() and hotReloadProcess() can track the running process.
      await execPromise(
        `${this.xrayBinary} -config ${this.configPath} > /var/log/xray/output.log 2>&1 & echo $! > ${this.pidFile}`
      );
      logger.info('Xray started');
      return { success: true, message: 'Xray started' };
    } catch (error) {
      logger.error('Failed to start Xray', {
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async stop() {
    try {
      const runtime = await this.resolveRuntimeStatus();

      if (runtime.mode === 'systemd') {
        await execPromise('systemctl stop xray');
      } else if (runtime.mode === 'docker') {
        await execPromise('docker stop xray-core');
      } else {
        // Kill process by PID
        const pid = (await fs.readFile(this.pidFile, 'utf8')).trim();
        if (!/^\d+$/.test(pid)) {
          throw new Error(`Invalid PID value in pid file: ${pid}`);
        }
        await execPromise(`kill ${pid}`);
      }
      logger.info('Xray stopped');
      return { success: true, message: 'Xray stopped' };
    } catch (error) {
      logger.error('Failed to stop Xray', {
        message: error.message,
        stack: error.stack
      });
      return { success: false, message: 'Failed to stop Xray' };
    }
  }

  async testConfig() {
    try {
      const runtime = await this.resolveRuntimeStatus();

      if (runtime.mode === 'docker') {
        const { stdout, stderr } = await execPromise(
          `docker exec xray-core ${this.xrayBinary} -test -config ${this.configPath}`
        );

        if (stderr && stderr.includes('failed')) {
          return { valid: false, error: stderr };
        }

        return { valid: true, message: stdout };
      }

      const { stdout, stderr } = await execPromise(`${this.xrayBinary} -test -config ${this.configPath}`);

      if (stderr && stderr.includes('failed')) {
        return { valid: false, error: stderr };
      }

      return { valid: true, message: stdout };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  async getStatus() {
    try {
      const runtime = await this.resolveRuntimeStatus();
      return {
        running: runtime.running,
        mode: runtime.mode,
        source: runtime.source,
        state: runtime.state,
        deploymentHint: runtime.deploymentHint,
        hintMismatch: runtime.hintMismatch
      };
    } catch (_error) {
      return { running: false };
    }
  }

  async getVersion() {
    try {
      const runtime = await this.resolveRuntimeStatus();

      if (runtime.mode === 'docker') {
        if (!runtime.details.docker?.running) {
          return 'unknown';
        }

        const dockerCommands = [
          `${this.xrayBinary} version`,
          'xray version',
          '/usr/local/bin/xray version',
          '/xray version'
        ];

        for (const command of dockerCommands) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const { stdout, stderr } = await execPromise(`docker exec xray-core ${command}`);
            const match = `${stdout || ''}\n${stderr || ''}`.match(/Xray\s+v?([\d.]+)/i);
            if (match?.[1]) {
              return match[1];
            }
          } catch (_error) {
            // Try next command fallback.
          }
        }

        try {
          const { stdout } = await execPromise('docker logs --tail=30 xray-core');
          const match = String(stdout || '').match(/Xray\s+v?([\d.]+)/i);
          if (match?.[1]) {
            return match[1];
          }
        } catch (_error) {
          // Ignore log-read fallback errors.
        }

        return 'unknown';
      }

      const localCommands = [
        `${this.xrayBinary} version`,
        'xray version'
      ];

      for (const command of localCommands) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const { stdout, stderr } = await execPromise(command);
          const match = `${stdout || ''}\n${stderr || ''}`.match(/Xray\s+v?([\d.]+)/i);
          if (match?.[1]) {
            return match[1];
          }
        } catch (_error) {
          // Try next command fallback.
        }
      }

      return 'unknown';
    } catch (_error) {
      return 'unknown';
    }
  }

  async status() {
    const status = await this.getStatus();
    const version = await this.getVersion();

    return {
      ...status,
      version,
      binaryPath: this.xrayBinary,
      configPath: this.configPath,
      pidFile: this.pidFile
    };
  }

  async reloadConfig() {
    const result = await this.applyGeneratedConfig({ applyMethod: 'hot' });

    return {
      success: true,
      message: 'Xray config applied with hot reload',
      inbounds: result.config.inbounds.length,
      configPath: this.configPath,
      apply: result.apply,
      snapshotId: result.snapshot?.id || null,
      confDir: result.confDir || null
    };
  }

  async rollbackConfigSnapshot(snapshotId, { applyMethod = 'restart' } = {}) {
    const safeSnapshotId = this.sanitizeSnapshotId(snapshotId);
    const snapshotConfigPath = path.join(this.snapshotDir, `${safeSnapshotId}.config.json`);
    const raw = await fs.readFile(snapshotConfigPath, 'utf8');
    const beforeRollbackSnapshot = await this.createCurrentSnapshot('before-rollback');
    await this.restoreConfig(raw);
    const apply = await this.applyRuntimeChange(applyMethod);

    return {
      success: true,
      message: 'Xray config rolled back from snapshot',
      snapshotId: safeSnapshotId,
      beforeRollbackSnapshotId: beforeRollbackSnapshot?.id || null,
      apply
    };
  }

  async syncConfDir() {
    const config = await configGenerator.generateConfig();
    const result = await configGenerator.saveConfigDirectory(config, this.confDirPath);
    return {
      success: true,
      message: 'Xray confdir synchronized',
      inbounds: config.inbounds.length,
      ...result
    };
  }

  async getConfDirStatus() {
    return configGenerator.listConfigDirectory(this.confDirPath);
  }
}

module.exports = new XrayManager();
