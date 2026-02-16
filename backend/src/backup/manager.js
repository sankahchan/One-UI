const cron = require('node-cron');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const env = require('../config/env');
const { getBotManager } = require('../telegram/bot');
const logger = require('../config/logger');

const execPromise = util.promisify(exec);

function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function isTarGzFile(name) {
  return name.startsWith('backup-') && name.endsWith('.tar.gz');
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

function jsonStringifyWithBigInt(value) {
  return JSON.stringify(
    value,
    (_key, nestedValue) => (typeof nestedValue === 'bigint' ? nestedValue.toString() : nestedValue),
    2
  );
}

function toDateOrNull(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toBigIntOrZero(value) {
  if (value === undefined || value === null || value === '') {
    return 0n;
  }

  try {
    return BigInt(value);
  } catch (_error) {
    return 0n;
  }
}

class BackupManager {
  constructor() {
    this.primaryBackupDir = env.BACKUP_DIR;
    this.fallbackBackupDir = path.join(process.cwd(), 'backups');
    this.backupDir = null;
    this.retentionDays = Math.max(1, env.BACKUP_RETENTION_DAYS);
    this.s3Enabled = env.S3_ENABLED;
    this.useDockerDbBackup = env.BACKUP_USE_DOCKER;
    this.dbContainer = env.BACKUP_DB_DOCKER_CONTAINER;
    this.schedule = env.BACKUP_SCHEDULE;
    this.scheduledTask = null;
    this.prisma = require('../config/database');
  }

  async resolveBackupDir() {
    if (this.backupDir) {
      return this.backupDir;
    }

    try {
      await fs.mkdir(this.primaryBackupDir, { recursive: true });
      this.backupDir = this.primaryBackupDir;
      return this.backupDir;
    } catch (error) {
      const permissionErrorCodes = new Set(['EACCES', 'EPERM', 'EROFS']);
      if (!permissionErrorCodes.has(error.code)) {
        throw error;
      }

      await fs.mkdir(this.fallbackBackupDir, { recursive: true });
      this.backupDir = this.fallbackBackupDir;

      logger.warn('Primary backup directory is not writable; using fallback path', {
        primaryBackupDir: this.primaryBackupDir,
        fallbackBackupDir: this.fallbackBackupDir,
        message: error.message
      });

      return this.backupDir;
    }
  }

  async sendAlert(message) {
    const botManager = getBotManager();
    if (!botManager?.enabled || typeof botManager.sendAlert !== 'function') {
      return;
    }

    await botManager.sendAlert(message);
  }

  async createBackup() {
    logger.info('Creating backup...');

    const backupDir = await this.resolveBackupDir();
    const backupName = `backup-${timestampForFilename()}`;
    const workingPath = path.join(backupDir, backupName);
    const archivePath = `${workingPath}.tar.gz`;

    await fs.mkdir(backupDir, { recursive: true });
    await fs.mkdir(workingPath, { recursive: true });

    try {
      await this.backupDatabase(workingPath);
      await this.backupCertificates(workingPath);
      await this.backupConfig(workingPath);

      await execPromise(
        `tar -czf ${shQuote(archivePath)} -C ${shQuote(backupDir)} ${shQuote(backupName)}`
      );
      await fs.rm(workingPath, { recursive: true, force: true });

      if (this.s3Enabled) {
        await this.uploadToS3(archivePath);
      }

      await this.cleanup();

      const archiveStats = await fs.stat(archivePath);
      logger.info(`Backup created: ${archivePath}`);

      await this.sendAlert(
        `*Backup Completed*\n\nFile: ${path.basename(archivePath)}\nSize: ${this.formatBytes(
          archiveStats.size
        )}\nDate: ${new Date().toLocaleString()}`
      );

      return archivePath;
    } catch (error) {
      await fs.rm(workingPath, { recursive: true, force: true }).catch(() => null);

      logger.error('Backup failed', {
        message: error.message,
        stack: error.stack
      });

      await this.sendAlert(`*Backup Failed*\n\n${error.message}`).catch(() => null);
      throw error;
    }
  }

  async backupDatabase(backupPath) {
    const dbFile = path.join(backupPath, 'database.sql');
    const dbJsonFile = path.join(backupPath, 'database.json');

    const dockerCommand = `docker exec ${shQuote(
      this.dbContainer
    )} pg_dump -U postgres xray_panel > ${shQuote(dbFile)}`;
    const localCommand = `pg_dump ${shQuote(env.DATABASE_URL)} -f ${shQuote(dbFile)}`;

    if (this.useDockerDbBackup) {
      try {
        await execPromise(dockerCommand);
        logger.info('Database backed up via docker');
        return;
      } catch (error) {
        logger.warn('Docker database backup failed; attempting local pg_dump', {
          message: error.message
        });
      }
    }

    try {
      await execPromise(localCommand);
      logger.info('Database backed up via local pg_dump');
    } catch (error) {
      logger.warn('Local pg_dump backup failed; falling back to Prisma JSON snapshot', {
        message: error.message
      });
      await this.backupDatabaseWithPrisma(dbJsonFile);
      logger.info('Database backed up via Prisma JSON snapshot');
    }
  }

  async backupDatabaseWithPrisma(targetFilePath) {
    const payload = {
      format: 'prisma-json-v1',
      generatedAt: new Date().toISOString(),
      data: {
        admins: await this.prisma.admin.findMany(),
        users: await this.prisma.user.findMany(),
        inbounds: await this.prisma.inbound.findMany(),
        userInbounds: await this.prisma.userInbound.findMany(),
        trafficLogs: await this.prisma.trafficLog.findMany(),
        systemLogs: await this.prisma.systemLog.findMany(),
        groups: await this.prisma.group.findMany(),
        userGroups: await this.prisma.userGroup.findMany(),
        groupInbounds: await this.prisma.groupInbound.findMany(),
        groupPolicyTemplates: await this.prisma.groupPolicyTemplate.findMany(),
        groupPolicySchedules: await this.prisma.groupPolicySchedule.findMany(),
        groupPolicyRollouts: await this.prisma.groupPolicyRollout.findMany(),
        apiKeys: await this.prisma.apiKey.findMany(),
        adminSessions: await this.prisma.adminSession.findMany(),
        notificationSettings: await this.prisma.notificationSetting.findMany(),
        notificationSettingsAuditLogs: await this.prisma.notificationSettingsAuditLog.findMany(),
        connectionLogs: await this.prisma.connectionLog.findMany(),
        xrayTemplates: await this.prisma.xrayTemplate.findMany(),
        workerLocks: await this.prisma.workerLock.findMany(),
        securityRules: await this.prisma.securityRule.findMany(),
        subscriptionBrandings: await this.prisma.subscriptionBranding.findMany(),
        usageSnapshots: await this.prisma.usageSnapshot.findMany(),
        subscriptionTemplates: await this.prisma.subscriptionTemplate.findMany()
      }
    };

    await fs.writeFile(targetFilePath, jsonStringifyWithBigInt(payload), 'utf8');
  }

  async backupCertificates(backupPath) {
    const certSource = env.SSL_CERT_PATH;
    const keySource = env.SSL_KEY_PATH;
    const certTargetDir = path.join(backupPath, 'certs');

    if (!(await pathExists(certSource))) {
      logger.warn('No certificates to backup');
      return;
    }

    const certStat = await fs.stat(certSource);
    await fs.mkdir(certTargetDir, { recursive: true });

    if (certStat.isDirectory()) {
      await fs.cp(certSource, certTargetDir, { recursive: true, force: true });
    } else {
      await fs.copyFile(certSource, path.join(certTargetDir, path.basename(certSource)));

      if (keySource && (await pathExists(keySource))) {
        await fs.copyFile(keySource, path.join(certTargetDir, path.basename(keySource)));
      }
    }

    logger.info('Certificates backed up');
  }

  async backupConfig(backupPath) {
    const envFile = path.join(process.cwd(), '.env');
    const envTarget = path.join(backupPath, '.env');

    if (await pathExists(envFile)) {
      await fs.copyFile(envFile, envTarget);
      logger.info('Config backed up');
      return;
    }

    logger.warn('No config file to backup');
  }

  async uploadToS3(archivePath) {
    if (!env.S3_BUCKET) {
      throw new Error('S3_BUCKET is required when S3_ENABLED=true');
    }

    const filename = path.basename(archivePath);
    await execPromise(`aws s3 cp ${shQuote(archivePath)} s3://${env.S3_BUCKET}/backups/${filename}`);
    logger.info('Backup uploaded to S3');
  }

  async cleanup() {
    const backupDir = await this.resolveBackupDir();
    const entries = await fs.readdir(backupDir);
    const backupFiles = entries.filter(isTarGzFile).sort().reverse();

    const staleFiles = backupFiles.slice(this.retentionDays);

    for (const file of staleFiles) {
      await fs.unlink(path.join(backupDir, file));
      logger.info(`Deleted old backup: ${file}`);
    }
  }

  async listBackups() {
    const backupDir = await this.resolveBackupDir();
    await fs.mkdir(backupDir, { recursive: true });
    const entries = await fs.readdir(backupDir);
    const backupFiles = entries.filter(isTarGzFile).sort().reverse();

    const result = [];
    for (const filename of backupFiles) {
      const filePath = path.join(backupDir, filename);
      const stat = await fs.stat(filePath);

      result.push({
        filename,
        path: filePath,
        size: stat.size,
        createdAt: stat.birthtime || stat.mtime
      });
    }

    return result;
  }

  async restoreDatabaseFromSql(dbFilePath) {
    if (this.useDockerDbBackup) {
      try {
        await execPromise(
          `docker exec -i ${shQuote(this.dbContainer)} psql -U postgres xray_panel < ${shQuote(dbFilePath)}`
        );
        return;
      } catch (error) {
        logger.warn('Docker database restore failed; attempting local psql', {
          message: error.message
        });
      }
    }

    await execPromise(`psql ${shQuote(env.DATABASE_URL)} -f ${shQuote(dbFilePath)}`);
  }

  async restoreDatabaseFromJson(dbFilePath) {
    const raw = await fs.readFile(dbFilePath, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || parsed.format !== 'prisma-json-v1' || typeof parsed.data !== 'object') {
      throw new Error('Unsupported JSON database backup format');
    }

    const {
      admins = [],
      users = [],
      inbounds = [],
      userInbounds = [],
      trafficLogs = [],
      systemLogs = [],
      groups = [],
      userGroups = [],
      groupInbounds = [],
      groupPolicyTemplates = [],
      groupPolicySchedules = [],
      groupPolicyRollouts = [],
      apiKeys = [],
      adminSessions = [],
      notificationSettings = [],
      notificationSettingsAuditLogs = [],
      connectionLogs = [],
      xrayTemplates = [],
      workerLocks = [],
      securityRules = [],
      subscriptionBrandings = [],
      usageSnapshots = [],
      subscriptionTemplates = []
    } = parsed.data;

    await this.prisma.$transaction([
      this.prisma.usageSnapshot.deleteMany(),
      this.prisma.subscriptionBranding.deleteMany(),
      this.prisma.notificationSettingsAuditLog.deleteMany(),
      this.prisma.notificationSetting.deleteMany(),
      this.prisma.connectionLog.deleteMany(),
      this.prisma.groupPolicyRollout.deleteMany(),
      this.prisma.groupPolicySchedule.deleteMany(),
      this.prisma.groupPolicyTemplate.deleteMany(),
      this.prisma.groupInbound.deleteMany(),
      this.prisma.userGroup.deleteMany(),
      this.prisma.workerLock.deleteMany(),
      this.prisma.securityRule.deleteMany(),
      this.prisma.xrayTemplate.deleteMany(),
      this.prisma.subscriptionTemplate.deleteMany(),
      this.prisma.adminSession.deleteMany(),
      this.prisma.apiKey.deleteMany(),
      this.prisma.trafficLog.deleteMany(),
      this.prisma.userInbound.deleteMany(),
      this.prisma.systemLog.deleteMany(),
      this.prisma.inbound.deleteMany(),
      this.prisma.user.deleteMany(),
      this.prisma.group.deleteMany(),
      this.prisma.admin.deleteMany()
    ]);

    if (admins.length > 0) {
      await this.prisma.admin.createMany({
        data: admins.map((row) => ({
          id: Number(row.id),
          username: row.username,
          password: row.password,
          role: row.role,
          email: row.email || null,
          telegramId: row.telegramId == null ? null : BigInt(row.telegramId),
          lastLoginAt: toDateOrNull(row.lastLoginAt),
          createdAt: toDateOrNull(row.createdAt) || new Date(),
          updatedAt: toDateOrNull(row.updatedAt) || new Date()
        }))
      });
    }

    if (users.length > 0) {
      await this.prisma.user.createMany({
        data: users.map((row) => ({
          id: Number(row.id),
          email: row.email,
          uuid: row.uuid,
          password: row.password,
          subscriptionToken: row.subscriptionToken,
          dataLimit: toBigIntOrZero(row.dataLimit),
          uploadUsed: toBigIntOrZero(row.uploadUsed),
          downloadUsed: toBigIntOrZero(row.downloadUsed),
          expireDate: toDateOrNull(row.expireDate) || new Date(),
          status: row.status,
          note: row.note || null,
          telegramUsername: row.telegramUsername || null,
          createdAt: toDateOrNull(row.createdAt) || new Date(),
          updatedAt: toDateOrNull(row.updatedAt) || new Date()
        }))
      });
    }

    if (inbounds.length > 0) {
      await this.prisma.inbound.createMany({
        data: inbounds.map((row) => ({
          id: Number(row.id),
          port: Number(row.port),
          protocol: row.protocol,
          tag: row.tag,
          remark: row.remark || null,
          enabled: Boolean(row.enabled),
          network: row.network,
          security: row.security,
          serverName: row.serverName || null,
          serverAddress: row.serverAddress,
          alpn: row.alpn || null,
          wsPath: row.wsPath || null,
          wsHost: row.wsHost || null,
          grpcServiceName: row.grpcServiceName || null,
          cipher: row.cipher || null,
          createdAt: toDateOrNull(row.createdAt) || new Date(),
          updatedAt: toDateOrNull(row.updatedAt) || new Date()
        }))
      });
    }

    if (userInbounds.length > 0) {
      await this.prisma.userInbound.createMany({
        data: userInbounds.map((row) => ({
          id: Number(row.id),
          userId: Number(row.userId),
          inboundId: Number(row.inboundId),
          enabled: Boolean(row.enabled),
          createdAt: toDateOrNull(row.createdAt) || new Date()
        }))
      });
    }

    if (trafficLogs.length > 0) {
      await this.prisma.trafficLog.createMany({
        data: trafficLogs.map((row) => ({
          id: Number(row.id),
          userId: Number(row.userId),
          upload: toBigIntOrZero(row.upload),
          download: toBigIntOrZero(row.download),
          timestamp: toDateOrNull(row.timestamp) || new Date()
        }))
      });
    }

    if (systemLogs.length > 0) {
      await this.prisma.systemLog.createMany({
        data: systemLogs.map((row) => ({
          id: Number(row.id),
          level: row.level,
          message: row.message,
          metadata: row.metadata || null,
          timestamp: toDateOrNull(row.timestamp) || new Date()
        }))
      });
    }

    await this.syncSequences();
  }

  async syncSequences() {
    const sequenceStatements = [
      `SELECT setval(pg_get_serial_sequence('"admins"', 'id'), COALESCE(MAX(id), 1), true) FROM "admins";`,
      `SELECT setval(pg_get_serial_sequence('"users"', 'id'), COALESCE(MAX(id), 1), true) FROM "users";`,
      `SELECT setval(pg_get_serial_sequence('"inbounds"', 'id'), COALESCE(MAX(id), 1), true) FROM "inbounds";`,
      `SELECT setval(pg_get_serial_sequence('"user_inbounds"', 'id'), COALESCE(MAX(id), 1), true) FROM "user_inbounds";`,
      `SELECT setval(pg_get_serial_sequence('"traffic_logs"', 'id'), COALESCE(MAX(id), 1), true) FROM "traffic_logs";`,
      `SELECT setval(pg_get_serial_sequence('"system_logs"', 'id'), COALESCE(MAX(id), 1), true) FROM "system_logs";`
    ];

    for (const sql of sequenceStatements) {
      await this.prisma.$executeRawUnsafe(sql);
    }
  }

  async restore(backupFile) {
    const backupDir = await this.resolveBackupDir();
    const backupFilePath = path.isAbsolute(backupFile)
      ? backupFile
      : path.join(backupDir, backupFile);

    logger.info(`Restoring from backup: ${backupFilePath}`);

    if (!(await pathExists(backupFilePath))) {
      throw new Error('Backup file not found');
    }

    const extractPath = path.join(backupDir, `restore-temp-${timestampForFilename()}`);
    await fs.mkdir(extractPath, { recursive: true });

    try {
      await execPromise(`tar -xzf ${shQuote(backupFilePath)} -C ${shQuote(extractPath)}`);

      const entries = await fs.readdir(extractPath, { withFileTypes: true });
      const extractedDir = entries.find((entry) => entry.isDirectory());

      if (!extractedDir) {
        throw new Error('Extracted backup content is invalid');
      }

      const backupContentDir = path.join(extractPath, extractedDir.name);
      const dbSqlFile = path.join(backupContentDir, 'database.sql');
      const dbJsonFile = path.join(backupContentDir, 'database.json');

      if (await pathExists(dbSqlFile)) {
        await this.restoreDatabaseFromSql(dbSqlFile);
      } else if (await pathExists(dbJsonFile)) {
        await this.restoreDatabaseFromJson(dbJsonFile);
      } else {
        throw new Error('No supported database backup file found');
      }

      logger.info('Database restored');

      const certsDir = path.join(backupContentDir, 'certs');
      if (await pathExists(certsDir)) {
        const certTarget = env.SSL_CERT_PATH;
        const certTargetExists = await pathExists(certTarget);

        if (!certTargetExists) {
          await fs.mkdir(certTarget, { recursive: true }).catch(() => null);
        }

        const certTargetStat = await fs
          .stat(certTarget)
          .catch(() => ({ isDirectory: () => true, isFile: () => false }));

        if (certTargetStat.isDirectory()) {
          await execPromise(`cp -R ${shQuote(path.join(certsDir, '.'))} ${shQuote(certTarget)}`);
        } else {
          const certFileName = path.basename(certTarget);
          const keyFileName = path.basename(env.SSL_KEY_PATH);

          const certSource = path.join(certsDir, certFileName);
          const keySource = path.join(certsDir, keyFileName);

          if (await pathExists(certSource)) {
            await fs.copyFile(certSource, certTarget);
          }

          if (env.SSL_KEY_PATH && (await pathExists(keySource))) {
            await fs.copyFile(keySource, env.SSL_KEY_PATH);
          }
        }

        logger.info('Certificates restored');
      } else {
        logger.warn('No certificates found in backup');
      }

      logger.info('Restore completed');
      return true;
    } catch (error) {
      logger.error('Restore failed', {
        message: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      await fs.rm(extractPath, { recursive: true, force: true }).catch(() => null);
    }
  }

  formatBytes(bytes) {
    if (!bytes) {
      return '0 B';
    }

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const value = bytes / Math.pow(k, i);
    return `${Number.parseFloat(value.toFixed(2))} ${sizes[i]}`;
  }

  startScheduledBackups() {
    if (this.scheduledTask) {
      return this.scheduledTask;
    }

    if (!cron.validate(this.schedule)) {
      logger.warn('Invalid backup schedule; scheduled backups disabled', {
        schedule: this.schedule
      });
      return null;
    }

    this.scheduledTask = cron.schedule(this.schedule, () => {
      void this.createBackup().catch((error) => {
        logger.error('Scheduled backup failed', {
          message: error.message,
          stack: error.stack
        });
      });
    });

    logger.info(`Scheduled backups started (cron: ${this.schedule})`);
    return this.scheduledTask;
  }

  stopScheduledBackups() {
    if (!this.scheduledTask) {
      return;
    }

    this.scheduledTask.stop();
    this.scheduledTask = null;
    logger.info('Scheduled backups stopped');
  }
}

module.exports = new BackupManager();
