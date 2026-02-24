const dotenv = require('dotenv');
const { cleanEnv, str, num, port, bool } = require('envalid');

dotenv.config();

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const env = cleanEnv(process.env, {
  NODE_ENV: str({ choices: ['development', 'test', 'production'], default: 'development' }),
  PORT: port({ default: 3000 }),
  API_VERSION: str({ default: 'v1' }),
  DATABASE_URL: str(),
  JWT_SECRET: str(),
  JWT_EXPIRY: str({ default: process.env.JWT_EXPIRES_IN || '7d' }),
  JWT_ACCESS_EXPIRY: str({ default: process.env.JWT_ACCESS_EXPIRY || '15m' }),
  JWT_REFRESH_EXPIRY: str({ default: '30d' }),
  AUTH_REQUIRE_2FA_SUPER_ADMIN: bool({
    default: false
  }),
  AUTH_STRICT_SESSION_BINDING: bool({ default: false }),
  AUTH_REQUIRE_SESSION_CLAIM: bool({
    default: String(process.env.NODE_ENV || 'development').toLowerCase() === 'production'
  }),
  AUTH_LOCKOUT_MAX_ATTEMPTS: num({ default: 5 }),
  AUTH_LOCKOUT_MINUTES: num({ default: 15 }),
  ADMIN_IP_ALLOWLIST: str({ default: '' }),
  ADMIN_REQUIRE_PRIVATE_IP: bool({ default: false }),
  SECRETS_ENCRYPTION_KEY: str({ default: '' }),
  SECRETS_ENCRYPTION_REQUIRED: bool({ default: false }),
  RATE_LIMIT_WINDOW_MS: num({ default: 15 * 60 * 1000 }),
  RATE_LIMIT_MAX_REQUESTS: num({ default: toNumber(process.env.RATE_LIMIT_MAX, 1000000) }),
  AUTH_RATE_LIMIT_MAX: num({ default: 1000000 }),
  AUTH_REFRESH_RATE_LIMIT_MAX: num({ default: 1000000 }),
  AUTH_PROFILE_RATE_LIMIT_MAX: num({ default: 1000000 }),
  LOG_LEVEL: str({ default: 'info' }),
  ALERT_WEBHOOK_SECRET: str({ default: 'change_this_alert_secret' }),
  WEBHOOK_ENABLED: bool({ default: false }),
  WEBHOOK_URL: str({ default: '' }),
  WEBHOOK_SECRET: str({ default: '' }),
  WEBHOOK_TIMEOUT_MS: num({ default: 10000 }),
  WEBHOOK_RETRY_ATTEMPTS: num({ default: 3 }),
  WEBHOOK_RETRY_DELAY_MS: num({ default: 1000 }),
  NOTIFICATION_MATRIX_JSON: str({ default: '' }),
  NOTIFICATION_DEFAULT_WEBHOOK: bool({ default: true }),
  NOTIFICATION_DEFAULT_TELEGRAM: bool({ default: false }),
  NOTIFICATION_DEFAULT_SYSTEM_LOG: bool({ default: true }),
  CORS_ORIGIN: str({ default: '*' }),
  SUBSCRIPTION_URL: str({ default: '' }),

  TELEGRAM_ENABLED: bool({ default: false }),
  TELEGRAM_BOT_TOKEN: str({ default: '' }),
  TELEGRAM_BOT_USERNAME: str({ default: '' }),
  TELEGRAM_OAUTH_ENABLED: bool({ default: false }),
  TELEGRAM_OAUTH_MAX_AGE_SECONDS: num({ default: 86400 }),
  TELEGRAM_OAUTH_LINK_BY_USERNAME: bool({ default: true }),
  TELEGRAM_ADMIN_IDS: str({ default: '' }),
  TELEGRAM_POLLING: bool({ default: true }),
  TELEGRAM_REPORT_CRON: str({ default: '0 9 * * *' }),
  TELEGRAM_NOTIFY_EXPIRY_DAYS: num({ default: 7 }),
  TELEGRAM_NOTIFY_DATA_THRESHOLD: num({ default: 10 }),
  TELEGRAM_ALERTS_ENABLED: bool({ default: true }),

  JOBS_ENABLED: bool({ default: true }),
  TRAFFIC_MONITOR_CRON: str({ default: '*/10 * * * *' }),
  EXPIRY_CHECK_CRON: str({ default: '0 * * * *' }),
  SSL_RENEW_CRON: str({ default: '0 3 * * *' }),
  SMART_FALLBACK_ENABLED: bool({ default: true }),
  SMART_FALLBACK_CRON: str({ default: '*/15 * * * *' }),
  SMART_FALLBACK_WINDOW_MINUTES: num({ default: 60 }),
  SMART_FALLBACK_MIN_KEYS: num({ default: 2 }),
  XRAY_TRAFFIC_SYNC_ENABLED: bool({ default: true }),
  XRAY_API_URL: str({ default: 'http://127.0.0.1:10085' }),
  XRAY_DEPLOYMENT: str({ default: '' }),
  XRAY_API_SERVER: str({ default: '' }),
  XRAY_API_CLI_TIMEOUT_MS: num({ default: 7000 }),
  XRAY_API_LISTEN: str({ default: '127.0.0.1' }),
  XRAY_API_ADDRESS: str({ default: '127.0.0.1' }),
  XRAY_AUTO_RELOAD: bool({ default: false }),
  XRAY_AUTO_RELOAD_STRICT: bool({ default: false }),
  MIERU_ENABLED: bool({ default: false }),
  MIERU_RUNTIME_MODE: str({ default: 'docker' }),
  MIERU_CONTAINER_NAME: str({ default: 'mieru-sidecar' }),
  MIERU_SERVICE_NAME: str({ default: 'mieru' }),
  MIERU_COMPOSE_FILE: str({ default: '' }),
  MIERU_HEALTH_URL: str({ default: '' }),
  MIERU_COMMAND_TIMEOUT_MS: num({ default: 7000 }),
  MIERU_VERSION_COMMAND: str({ default: 'mita version || mieru version' }),
  MIERU_RESTART_COMMAND: str({ default: '' }),
  MIERU_LOG_PATH: str({ default: '' }),
  TRAFFIC_SYNC_INTERVAL: num({ default: 60 }),
  SYSTEM_MONITOR_ENABLED: bool({ default: true }),
  SYSTEM_MONITOR_INTERVAL: num({ default: 300 }),
  SYSTEM_MONITOR_ALERT_COOLDOWN: num({ default: 1800 }),
  CPU_THRESHOLD: num({ default: 80 }),
  MEMORY_THRESHOLD: num({ default: 80 }),
  DISK_THRESHOLD: num({ default: 80 }),
  BACKUP_ENABLED: bool({ default: false }),
  BACKUP_DIR: str({ default: '/var/backups/xray-panel' }),
  BACKUP_RETENTION_DAYS: num({ default: 7 }),
  BACKUP_SCHEDULE: str({ default: '0 2 * * *' }),
  BACKUP_USE_DOCKER: bool({ default: true }),
  BACKUP_DB_DOCKER_CONTAINER: str({ default: 'xray-panel-db' }),
  S3_ENABLED: bool({ default: false }),
  S3_BUCKET: str({ default: '' }),

  SSL_ENABLED: bool({ default: false }),
  ACME_SH_PATH: str({ default: '' }),
  ACME_HOME: str({ default: '' }),
  SSL_DOMAIN: str({ default: '' }),
  SSL_EMAIL: str({ default: '' }),
  SSL_CERT_PATH: str({ default: '/certs/fullchain.pem' }),
  SSL_KEY_PATH: str({ default: '/certs/key.pem' }),
  SSL_RENEW_DAYS: num({ default: 30 }),
  SSL_RELOAD_CMD: str({ default: '' }),

  STARTUP_MIGRATION_GATE: bool({ default: true }),
  STARTUP_MIGRATION_CMD: str({ default: 'npx prisma migrate deploy' }),
  STARTUP_HEALTH_GATE: bool({ default: true }),
  STARTUP_HEALTH_GATE_STRICT: bool({
    default: String(process.env.NODE_ENV || 'development').toLowerCase() === 'production'
  }),
  STARTUP_HEALTH_GATE_TIMEOUT_MS: num({ default: 7000 }),
  STARTUP_HEALTH_REQUIRE_XRAY: bool({
    default: String(process.env.NODE_ENV || 'development').toLowerCase() === 'production'
  }),
  USER_ONLINE_TTL_SECONDS: num({ default: 60 }),
  USER_ONLINE_IDLE_TTL_SECONDS: num({ default: 75 }),
  USER_ONLINE_DEVICE_TTL_SECONDS: num({ default: 60 }),
  USER_ONLINE_REFRESH_INTERVAL_SECONDS: num({ default: 5 }),
  DEVICE_TRACKING_TTL_SECONDS: num({ default: 1800 }),
  SECURITY_RULES_ENABLED: bool({ default: true }),
  MYANMAR_DEFAULTS_ENABLED: bool({ default: true }),

  WORKER_MODE: str({ choices: ['inline', 'separate', 'worker'], default: 'inline' }),
  WORKER_LOCK_NAME: str({ default: 'one-ui-jobs' }),
  WORKER_LOCK_TTL_SECONDS: num({ default: 45 }),
  WORKER_HEARTBEAT_INTERVAL_SECONDS: num({ default: 15 }),
  WORKER_RETRY_MS: num({ default: 10000 }),

  SUBSCRIPTION_BRANDING_ENABLED: bool({ default: true }),
  ANALYTICS_SNAPSHOTS_ENABLED: bool({ default: true }),
  ANALYTICS_SNAPSHOT_INTERVAL_SECONDS: num({ default: 300 }),
  ANALYTICS_SPIKE_FACTOR: num({ default: 2.5 }),
  ANALYTICS_MIN_SPIKE_BYTES: num({ default: 10 * 1024 * 1024 }),

  CLOUDFLARE_API_TOKEN: str({ default: '' }),
  CLOUDFLARE_ZONE_ID: str({ default: '' }),
  CLOUDFLARE_EMAIL: str({ default: '' }),
  CLOUDFLARE_ACCOUNT_EMAIL: str({ default: '' }),
  CLOUDFLARE_API_KEY: str({ default: '' }),

  MARZBAN_BASE_URL: str({ default: '' }),
  MARZBAN_ADMIN_USERNAME: str({ default: '' }),
  MARZBAN_ADMIN_PASSWORD: str({ default: '' }),
  MARZBAN_TOKEN_REFRESH_INTERVAL: num({ default: 3300000 }),
  MARZBAN_WEBHOOK_SECRET: str({ default: '' })
});

function hasPlaceholderValue(value = '') {
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    'changeme',
    'change_this',
    'your_super_secret',
    'your_bot_token',
    'your@email.com',
    'yourdomain.com',
    'example.com'
  ].some((token) => normalized.includes(token));
}

function validateProductionEnv() {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  const issues = [];

  if (env.JWT_SECRET.length < 32 || hasPlaceholderValue(env.JWT_SECRET)) {
    issues.push('JWT_SECRET must be at least 32 chars and must not be a placeholder');
  }

  if (env.CORS_ORIGIN === '*') {
    issues.push('CORS_ORIGIN cannot be "*" in production');
  }

  if (env.ALERT_WEBHOOK_SECRET.length < 16 || hasPlaceholderValue(env.ALERT_WEBHOOK_SECRET)) {
    issues.push('ALERT_WEBHOOK_SECRET must be a strong non-placeholder value');
  }

  if (env.WEBHOOK_ENABLED) {
    if (!env.WEBHOOK_URL.trim()) {
      issues.push('WEBHOOK_URL is required when WEBHOOK_ENABLED=true');
    }

    const signingSecret = env.WEBHOOK_SECRET || env.ALERT_WEBHOOK_SECRET;
    if (!signingSecret || signingSecret.length < 16 || hasPlaceholderValue(signingSecret)) {
      issues.push('WEBHOOK_SECRET (or ALERT_WEBHOOK_SECRET) must be a strong non-placeholder value when WEBHOOK_ENABLED=true');
    }
  }

  if (env.TELEGRAM_ENABLED) {
    if (!env.TELEGRAM_BOT_TOKEN || hasPlaceholderValue(env.TELEGRAM_BOT_TOKEN)) {
      issues.push('TELEGRAM_BOT_TOKEN is required when TELEGRAM_ENABLED=true');
    }
    if (!env.TELEGRAM_ADMIN_IDS.trim()) {
      issues.push('TELEGRAM_ADMIN_IDS is required when TELEGRAM_ENABLED=true');
    }
  }

  if (env.TELEGRAM_OAUTH_ENABLED) {
    if (!env.TELEGRAM_BOT_TOKEN || hasPlaceholderValue(env.TELEGRAM_BOT_TOKEN)) {
      issues.push('TELEGRAM_BOT_TOKEN is required when TELEGRAM_OAUTH_ENABLED=true');
    }
    if (!env.TELEGRAM_BOT_USERNAME.trim()) {
      issues.push('TELEGRAM_BOT_USERNAME is required when TELEGRAM_OAUTH_ENABLED=true');
    }
  }

  if (env.SSL_ENABLED) {
    if (!env.SSL_DOMAIN.trim() || hasPlaceholderValue(env.SSL_DOMAIN)) {
      issues.push('SSL_DOMAIN must be configured when SSL_ENABLED=true');
    }
    if (!env.SSL_EMAIL.trim() || hasPlaceholderValue(env.SSL_EMAIL)) {
      issues.push('SSL_EMAIL must be configured when SSL_ENABLED=true');
    }
  }

  if (env.SECRETS_ENCRYPTION_REQUIRED && !env.SECRETS_ENCRYPTION_KEY.trim()) {
    issues.push('SECRETS_ENCRYPTION_KEY is required when SECRETS_ENCRYPTION_REQUIRED=true');
  }

  if (env.S3_ENABLED && !env.S3_BUCKET.trim()) {
    issues.push('S3_BUCKET is required when S3_ENABLED=true');
  }

  if (env.STARTUP_HEALTH_GATE_TIMEOUT_MS < 1000) {
    issues.push('STARTUP_HEALTH_GATE_TIMEOUT_MS must be at least 1000');
  }

  if (issues.length > 0) {
    throw new Error(`Production environment validation failed:\n- ${issues.join('\n- ')}`);
  }
}

validateProductionEnv();

module.exports = env;
