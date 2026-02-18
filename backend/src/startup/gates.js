const { spawn } = require('child_process');
const path = require('path');

const env = require('../config/env');
const logger = require('../config/logger');
const prisma = require('../config/database');
const statsCollector = require('../xray/stats-collector');

const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

function parseCommand(commandString) {
  return String(commandString || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || BACKEND_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `Command failed (${command} ${args.join(' ')}), exit code ${code}\n${stderr || stdout}`
        )
      );
    });
  });
}

async function runStartupMigrationGate() {
  if (!env.STARTUP_MIGRATION_GATE) {
    logger.info('Startup migration gate disabled');
    return;
  }

  const parts = parseCommand(env.STARTUP_MIGRATION_CMD);
  if (parts.length === 0) {
    throw new Error('STARTUP_MIGRATION_CMD is empty');
  }

  const [command, ...args] = parts;
  logger.info('Running startup migration gate', {
    command: `${command} ${args.join(' ')}`.trim()
  });

  const startedAt = Date.now();
  await runCommand(command, args, { cwd: BACKEND_ROOT });
  logger.info('Startup migration gate completed', {
    durationMs: Date.now() - startedAt
  });
}

async function checkDatabaseHealth() {
  await prisma.$queryRaw`SELECT 1`;
}

async function checkXrayStatsHealth() {
  const timeoutMs = Math.max(1000, Number(env.STARTUP_HEALTH_GATE_TIMEOUT_MS || 7000));
  await Promise.race([
    statsCollector.checkHealth(),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Xray stats health check timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}

async function runStartupHealthGate() {
  if (!env.STARTUP_HEALTH_GATE) {
    logger.info('Startup health gate disabled');
    return;
  }

  const failures = [];

  const checks = [
    {
      name: 'database',
      fn: checkDatabaseHealth
    }
  ];

  if (env.STARTUP_HEALTH_REQUIRE_XRAY) {
    checks.push({
      name: 'xray-stats-api',
      fn: checkXrayStatsHealth
    });
  }

  for (const check of checks) {
    const startedAt = Date.now();
    try {
      await check.fn();
      logger.info('Startup health check passed', {
        check: check.name,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      failures.push({
        check: check.name,
        message: error.message
      });
      logger.error('Startup health check failed', {
        check: check.name,
        durationMs: Date.now() - startedAt,
        message: error.message
      });
    }
  }

  if (failures.length > 0) {
    const reason = failures.map((entry) => `${entry.check}: ${entry.message}`).join('; ');
    if (env.STARTUP_HEALTH_GATE_STRICT) {
      throw new Error(`Startup health gate failed: ${reason}`);
    }

    logger.warn('Startup health gate had failures but strict mode is disabled', {
      failures
    });
  }
}

module.exports = {
  runStartupMigrationGate,
  runStartupHealthGate
};
