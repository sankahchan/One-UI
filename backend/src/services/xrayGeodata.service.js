const https = require('node:https');
const fs = require('node:fs');
const fsp = require('node:fs').promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('child_process');

const logger = require('../config/logger');
const { ValidationError } = require('../utils/errors');

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

function downloadText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(downloadText(res.headers.location));
          return;
        }
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`Request failed (${res.statusCode || 'unknown'})`));
          return;
        }

        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

function downloadFile(url, destinationPath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(downloadFile(res.headers.location, destinationPath));
          return;
        }
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`Request failed (${res.statusCode || 'unknown'})`));
          return;
        }

        const writer = fs.createWriteStream(destinationPath);
        res.pipe(writer);
        writer.on('finish', () => {
          writer.close();
          resolve();
        });
        writer.on('error', (error) => {
          writer.destroy();
          reject(error);
        });
      })
      .on('error', reject);
  });
}

function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

class XrayGeodataService {
  constructor() {
    this.geoDir = process.env.XRAY_GEO_PATH || process.env.XRAY_GEODATA_DIR || '/usr/local/share/xray';
    this.files = [
      {
        key: 'geosite',
        name: 'geosite.dat',
        path: process.env.XRAY_GEOSITE_PATH || path.join(this.geoDir, 'geosite.dat'),
        url: process.env.XRAY_GEOSITE_URL || 'https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat',
        checksumUrl:
          process.env.XRAY_GEOSITE_CHECKSUM_URL || 'https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat.sha256sum'
      },
      {
        key: 'geoip',
        name: 'geoip.dat',
        path: process.env.XRAY_GEOIP_PATH || path.join(this.geoDir, 'geoip.dat'),
        url: process.env.XRAY_GEOIP_URL || 'https://github.com/v2fly/geoip/releases/latest/download/geoip.dat',
        checksumUrl: process.env.XRAY_GEOIP_CHECKSUM_URL || 'https://github.com/v2fly/geoip/releases/latest/download/geoip.dat.sha256sum'
      }
    ];
    this.updateCommand = String(process.env.XRAY_GEODATA_UPDATE_COMMAND || '').trim();
    this.updateTimeoutMs = parsePositiveInt(process.env.XRAY_GEODATA_UPDATE_TIMEOUT_MS, 300_000, 5_000, 900_000);
  }

  async getStatus({ includeHash = false } = {}) {
    const output = [];

    for (const file of this.files) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const stat = await fsp.stat(file.path);
        const status = {
          key: file.key,
          name: file.name,
          path: file.path,
          exists: true,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString()
        };
        if (includeHash) {
          // eslint-disable-next-line no-await-in-loop
          status.sha256 = await computeSha256(file.path);
        }
        output.push(status);
      } catch (_error) {
        output.push({
          key: file.key,
          name: file.name,
          path: file.path,
          exists: false,
          size: 0,
          modifiedAt: null
        });
      }
    }

    return {
      directory: this.geoDir,
      files: output
    };
  }

  async runUpdateCommand(command) {
    return new Promise((resolve) => {
      const child = spawn(command, {
        cwd: path.resolve(process.cwd()),
        env: process.env,
        shell: true,
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
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          ok: !timedOut && code === 0,
          code,
          timedOut,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          code: null,
          timedOut: false,
          stdout: '',
          stderr: error.message
        });
      });
    });
  }

  async updateFromDownloads() {
    await fsp.mkdir(this.geoDir, { recursive: true });
    const results = [];

    for (const file of this.files) {
      const targetPath = file.path;
      const tmpPath = `${targetPath}.tmp`;
      try {
        // eslint-disable-next-line no-await-in-loop
        await fsp.mkdir(path.dirname(targetPath), { recursive: true });
        // eslint-disable-next-line no-await-in-loop
        await downloadFile(file.url, tmpPath);
        // eslint-disable-next-line no-await-in-loop
        const checksumRaw = (await downloadText(file.checksumUrl)).trim();
        const expected = checksumRaw.split(/\s+/)[0]?.toLowerCase();
        // eslint-disable-next-line no-await-in-loop
        const actual = (await computeSha256(tmpPath)).toLowerCase();

        if (!expected || expected !== actual) {
          throw new Error(`Checksum mismatch for ${file.name}`);
        }

        // eslint-disable-next-line no-await-in-loop
        await fsp.rename(tmpPath, targetPath);
        results.push({
          key: file.key,
          name: file.name,
          status: 'updated',
          sha256: actual
        });
      } catch (error) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await fsp.rm(tmpPath, { force: true });
        } catch (_cleanupError) {
          // ignore
        }
        results.push({
          key: file.key,
          name: file.name,
          status: 'failed',
          error: error.message
        });
      }
    }

    return results;
  }

  async update(options = {}) {
    const useCommand = parseBoolean(options.useCommand, true);
    const forceDownload = parseBoolean(options.forceDownload, false);
    const command = String(options.command || this.updateCommand || '').trim();

    if (useCommand && command && !forceDownload) {
      const commandResult = await this.runUpdateCommand(command);
      if (!commandResult.ok) {
        throw new ValidationError(commandResult.stderr || commandResult.stdout || 'Geodata update command failed');
      }

      return {
        mode: 'command',
        command,
        output: commandResult.stdout || null
      };
    }

    const results = await this.updateFromDownloads();
    const failed = results.filter((entry) => entry.status !== 'updated');
    if (failed.length > 0) {
      logger.warn('Geodata update completed with failures', {
        failed
      });
    }

    return {
      mode: 'download',
      results
    };
  }
}

module.exports = new XrayGeodataService();
