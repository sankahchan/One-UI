const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { exec, execFile } = require('child_process');
const util = require('util');

const env = require('../config/env');
const logger = require('../config/logger');

const execPromise = util.promisify(exec);
const execFilePromise = util.promisify(execFile);

function withHomeExpanded(value) {
  if (!value) {
    return value;
  }

  return value.replace('$HOME', os.homedir());
}

function resolveAcmePath() {
  const configured = process.env.ACME_SH_PATH || env.ACME_SH_PATH;
  if (configured) {
    return withHomeExpanded(configured);
  }

  const acmeHome = process.env.ACME_HOME || env.ACME_HOME;
  if (acmeHome) {
    return path.join(withHomeExpanded(acmeHome), 'acme.sh');
  }

  return path.join(os.homedir(), '.acme.sh', 'acme.sh');
}

function normalizeDomain(domain) {
  if (!domain || typeof domain !== 'string') {
    return '';
  }

  return domain.trim().replace(/^\*\./, '');
}

function looksLikeCertFile(targetPath) {
  if (!targetPath) {
    return false;
  }

  const ext = path.extname(targetPath).toLowerCase();
  return ext === '.pem' || ext === '.crt' || ext === '.cer';
}

class AcmeManager {
  constructor() {
    this.acmePath = resolveAcmePath();
    this.acmeHome = process.env.ACME_HOME || env.ACME_HOME || path.dirname(this.acmePath);
    this.certPath = process.env.SSL_CERT_PATH || env.SSL_CERT_PATH || '/var/lib/xray-panel/certs';
    this.keyPath = process.env.SSL_KEY_PATH || env.SSL_KEY_PATH || '/var/lib/xray-panel/certs/key.pem';
    this.reloadCmd = process.env.SSL_RELOAD_CMD || env.SSL_RELOAD_CMD || '';
  }

  getAcmeEnv(overrides = {}) {
    return {
      ...process.env,
      CF_Token: env.CLOUDFLARE_API_TOKEN || process.env.CF_Token,
      CF_Zone_ID: env.CLOUDFLARE_ZONE_ID || process.env.CF_Zone_ID,
      CF_Email: env.CLOUDFLARE_ACCOUNT_EMAIL || env.CLOUDFLARE_EMAIL || process.env.CF_Email,
      CF_Key: env.CLOUDFLARE_API_KEY || process.env.CF_Key,
      ...overrides
    };
  }

  resolveInstallPaths({ certPath, keyPath } = {}) {
    const targetCertPath = certPath || this.certPath;

    if (looksLikeCertFile(targetCertPath)) {
      const certDir = path.dirname(targetCertPath);
      return {
        certDir,
        certFile: path.join(certDir, 'cert.pem'),
        keyFile: keyPath || this.keyPath || path.join(certDir, 'key.pem'),
        fullchainFile: targetCertPath
      };
    }

    const certDir = targetCertPath;
    return {
      certDir,
      certFile: path.join(certDir, 'cert.pem'),
      keyFile: keyPath || path.join(certDir, 'key.pem'),
      fullchainFile: path.join(certDir, 'fullchain.pem')
    };
  }

  async install(email = process.env.ACME_EMAIL || env.SSL_EMAIL || process.env.SSL_EMAIL || 'my@example.com') {
    try {
      await fs.access(this.acmePath);
      logger.info('acme.sh already installed');
      return true;
    } catch (_error) {
      logger.info('Installing acme.sh...');
    }

    try {
      await execPromise(`curl -fsSL https://get.acme.sh | sh -s email=${email}`, {
        maxBuffer: 1024 * 1024 * 10
      });

      await fs.access(this.acmePath);
      logger.info('acme.sh installed successfully');
      return true;
    } catch (error) {
      logger.error('Failed to install acme.sh', {
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async ensureInstalled() {
    try {
      await fs.access(this.acmePath);
    } catch (_error) {
      await this.install();
    }
  }

  async runAcme(args, { extraEnv = {} } = {}) {
    await this.ensureInstalled();

    logger.info('Running acme.sh command', {
      command: `${this.acmePath} ${args.join(' ')}`
    });

    const { stdout, stderr } = await execFilePromise(this.acmePath, args, {
      env: this.getAcmeEnv(extraEnv),
      maxBuffer: 1024 * 1024 * 10
    });

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim()
    };
  }

  async runAcmeWithEccFallback(baseArgs, options = {}) {
    try {
      return await this.runAcme([...baseArgs, '--ecc'], options);
    } catch (error) {
      logger.warn('acme.sh command with --ecc failed, retrying without --ecc', {
        message: error.message
      });
      return this.runAcme(baseArgs, options);
    }
  }

  async issueWildcard(
    domain = env.SSL_DOMAIN,
    cloudflareEmail = env.CLOUDFLARE_ACCOUNT_EMAIL,
    cloudflareApiKey = env.CLOUDFLARE_API_KEY
  ) {
    const rootDomain = normalizeDomain(domain);
    if (!rootDomain) {
      throw new Error('SSL domain is required');
    }

    logger.info(`Issuing wildcard certificate for ${rootDomain}...`);

    const extraEnv = {};
    if (cloudflareEmail) {
      extraEnv.CF_Email = cloudflareEmail;
    }
    if (cloudflareApiKey) {
      extraEnv.CF_Key = cloudflareApiKey;
    }

    const issueResult = await this.runAcme(
      ['--issue', '--dns', 'dns_cf', '-d', rootDomain, '-d', `*.${rootDomain}`, '--log'],
      { extraEnv }
    );

    await this.installCertificate(rootDomain);
    logger.info('Certificate issued successfully');
    return issueResult;
  }

  async issueWildcardCertificate(domain = env.SSL_DOMAIN) {
    return this.issueWildcard(domain);
  }

  async installCertificate(options = {}) {
    const normalized = typeof options === 'string' ? { domain: options } : options || {};
    const domain = normalizeDomain(normalized.domain || env.SSL_DOMAIN);

    if (!domain) {
      throw new Error('SSL domain is required');
    }

    logger.info(`Installing certificate for ${domain}...`);

    const paths = this.resolveInstallPaths({
      certPath: normalized.certPath,
      keyPath: normalized.keyPath
    });
    await fs.mkdir(paths.certDir, { recursive: true });

    const args = [
      '--install-cert',
      '-d',
      domain,
      '--cert-file',
      paths.certFile,
      '--key-file',
      paths.keyFile,
      '--fullchain-file',
      paths.fullchainFile
    ];

    const reloadCmd = normalized.reloadCmd !== undefined ? normalized.reloadCmd : this.reloadCmd;
    if (reloadCmd) {
      args.push('--reloadcmd', reloadCmd);
    }

    const result = await this.runAcmeWithEccFallback(args);

    try {
      await execPromise(`chmod 644 "${paths.certDir}"/*.pem`);
    } catch (_error) {
      // permissions update is best effort
    }

    logger.info('Certificate installed successfully');
    return result;
  }

  async renew(domain = env.SSL_DOMAIN) {
    const rootDomain = normalizeDomain(domain);
    if (!rootDomain) {
      throw new Error('SSL domain is required');
    }

    logger.info(`Renewing certificate for ${rootDomain}...`);

    const renewResult = await this.runAcmeWithEccFallback(['--renew', '-d', rootDomain, '--force']);
    await this.installCertificate(rootDomain);

    logger.info('Certificate renewed successfully');
    return renewResult;
  }

  async renewCertificate(domain = env.SSL_DOMAIN) {
    return this.renew(domain);
  }

  async listCertificates() {
    return this.runAcme(['--list']);
  }

  async getCertificateInfo(domain = env.SSL_DOMAIN) {
    const rootDomain = normalizeDomain(domain);
    if (!rootDomain) {
      throw new Error('SSL domain is required');
    }

    try {
      const { fullchainFile } = this.resolveInstallPaths();
      const { stdout } = await execPromise(`openssl x509 -in "${fullchainFile}" -noout -dates`);

      const notBefore = stdout.match(/notBefore=(.+)/)?.[1]?.trim();
      const notAfter = stdout.match(/notAfter=(.+)/)?.[1]?.trim();

      if (!notBefore || !notAfter) {
        throw new Error('Unable to parse certificate validity dates');
      }

      return {
        domain: rootDomain,
        certFile: fullchainFile,
        notBefore: new Date(notBefore),
        notAfter: new Date(notAfter),
        daysRemaining: Math.ceil((new Date(notAfter).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      };
    } catch (error) {
      logger.error('Failed to get certificate info', {
        message: error.message,
        stack: error.stack
      });
      return null;
    }
  }
}

module.exports = new AcmeManager();
