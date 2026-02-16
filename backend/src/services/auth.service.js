const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const prisma = require('../config/database');
const env = require('../config/env');
const logger = require('../config/logger');
const totpService = require('./totp.service');
const secretCryptoService = require('./secretCrypto.service');
const { parseAllowlist, isIpAllowed, isPrivateIp } = require('../utils/network');
const { UnauthorizedError, ConflictError, ForbiddenError, ValidationError } = require('../utils/errors');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function secondsToDate(secondsSinceEpoch) {
  return new Date(secondsSinceEpoch * 1000);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on', 'y'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off', 'n'].includes(normalized)) {
    return false;
  }

  return fallback;
}

class AuthService {
  constructor() {
    this.adminIpAllowlist = parseAllowlist(env.ADMIN_IP_ALLOWLIST);
  }

  getAdminIpAllowlist() {
    return [...this.adminIpAllowlist];
  }

  updateAdminIpAllowlist(allowlistValue) {
    this.adminIpAllowlist = parseAllowlist(allowlistValue);
    process.env.ADMIN_IP_ALLOWLIST = this.adminIpAllowlist.join(',');
    return this.getAdminIpAllowlist();
  }

  isPrivateIpRestrictionEnabled() {
    return parseBoolean(process.env.ADMIN_REQUIRE_PRIVATE_IP, env.ADMIN_REQUIRE_PRIVATE_IP);
  }

  isSuperAdmin2FARequired() {
    return parseBoolean(process.env.AUTH_REQUIRE_2FA_SUPER_ADMIN, env.AUTH_REQUIRE_2FA_SUPER_ADMIN);
  }

  isStrictSessionBindingEnabled() {
    return parseBoolean(process.env.AUTH_STRICT_SESSION_BINDING, env.AUTH_STRICT_SESSION_BINDING);
  }

  isSessionClaimRequired() {
    return parseBoolean(process.env.AUTH_REQUIRE_SESSION_CLAIM, env.AUTH_REQUIRE_SESSION_CLAIM);
  }

  getTotpSecret(admin) {
    const encryptedOrRawSecret = admin?.twoFactorSecret ? String(admin.twoFactorSecret) : '';
    if (!encryptedOrRawSecret) {
      return '';
    }

    try {
      return secretCryptoService.decrypt(encryptedOrRawSecret, { allowPlaintext: true });
    } catch (_error) {
      throw new UnauthorizedError('Invalid two-factor secret configuration');
    }
  }

  isAdminIpAllowed(ipAddress) {
    if (!isIpAllowed(ipAddress, this.adminIpAllowlist)) {
      return false;
    }

    if (this.isPrivateIpRestrictionEnabled() && !isPrivateIp(ipAddress)) {
      return false;
    }

    return true;
  }

  generateSessionId() {
    return crypto.randomBytes(18).toString('hex');
  }

  signAccessToken(admin, sessionId = null) {
    const payload = {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      type: 'access'
    };

    if (sessionId) {
      payload.sid = sessionId;
    }

    return jwt.sign(
      payload,
      env.JWT_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRY || env.JWT_EXPIRY || '7d' }
    );
  }

  signRefreshToken(admin, sessionId) {
    return jwt.sign(
      {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        type: 'refresh',
        sid: sessionId,
        rid: crypto.randomBytes(8).toString('hex')
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRY || '30d' }
    );
  }

  verifyAccessToken(token) {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET);
      if (payload.type && payload.type !== 'access') {
        throw new UnauthorizedError('Invalid access token');
      }

      return payload;
    } catch (_error) {
      throw new UnauthorizedError('Invalid token');
    }
  }

  verifyRefreshToken(token) {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET);
      if (payload.type !== 'refresh' || !payload.sid) {
        throw new UnauthorizedError('Invalid refresh token');
      }

      return payload;
    } catch (_error) {
      throw new UnauthorizedError('Invalid refresh token');
    }
  }

  verifyToken(token) {
    return this.verifyAccessToken(token);
  }

  async registerFailedLogin(admin) {
    const attempts = (admin.failedLoginAttempts || 0) + 1;
    const maxAttempts = Math.max(1, env.AUTH_LOCKOUT_MAX_ATTEMPTS);
    const shouldLock = attempts >= maxAttempts;
    const lockoutMinutes = Math.max(1, env.AUTH_LOCKOUT_MINUTES);
    const lockedUntil = shouldLock ? new Date(Date.now() + lockoutMinutes * 60 * 1000) : null;

    await prisma.admin.update({
      where: { id: admin.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil
      }
    });
  }

  async resetFailedLogin(adminId) {
    await prisma.admin.update({
      where: { id: adminId },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null
      }
    });
  }

  async createSession(admin, { ipAddress = null, userAgent = null } = {}) {
    const sessionId = this.generateSessionId();
    const refreshToken = this.signRefreshToken(admin, sessionId);
    const decoded = jwt.decode(refreshToken);
    if (!decoded || typeof decoded.exp !== 'number') {
      throw new UnauthorizedError('Failed to generate session');
    }

    await prisma.adminSession.create({
      data: {
        adminId: admin.id,
        tokenHash: hashToken(refreshToken),
        jti: sessionId,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        expiresAt: secondsToDate(decoded.exp),
        lastUsedAt: new Date()
      }
    });

    return {
      refreshToken,
      sessionId
    };
  }

  normalizeTelegramAuthPayload(payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ValidationError('Invalid Telegram auth payload');
    }

    const normalized = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null) {
        continue;
      }
      normalized[key] = String(value);
    }

    return normalized;
  }

  verifyTelegramAuthPayload(payload = {}) {
    if (!env.TELEGRAM_OAUTH_ENABLED) {
      throw new ForbiddenError('Telegram OAuth login is disabled');
    }

    if (!env.TELEGRAM_BOT_TOKEN) {
      throw new ForbiddenError('Telegram bot token is not configured');
    }

    const normalizedPayload = this.normalizeTelegramAuthPayload(payload);
    const telegramIdRaw = normalizedPayload.id;
    const authDateRaw = normalizedPayload.auth_date;
    const incomingHash = normalizedPayload.hash;

    if (!telegramIdRaw || !authDateRaw || !incomingHash) {
      throw new ValidationError('Telegram auth payload is incomplete');
    }

    const authDate = Number.parseInt(authDateRaw, 10);
    if (!Number.isInteger(authDate)) {
      throw new ValidationError('Telegram auth payload has invalid auth_date');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const maxAgeSeconds = Math.max(30, env.TELEGRAM_OAUTH_MAX_AGE_SECONDS);
    if (Math.abs(nowSeconds - authDate) > maxAgeSeconds) {
      throw new UnauthorizedError('Telegram login request has expired');
    }

    const dataCheckString = Object.keys(normalizedPayload)
      .filter((key) => key !== 'hash')
      .sort()
      .map((key) => `${key}=${normalizedPayload[key]}`)
      .join('\n');

    const secretKey = crypto.createHash('sha256').update(env.TELEGRAM_BOT_TOKEN).digest();
    const expectedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    const incomingBuffer = Buffer.from(incomingHash, 'utf8');
    const expectedBuffer = Buffer.from(expectedHash, 'utf8');
    if (
      incomingBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(incomingBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedError('Telegram signature verification failed');
    }

    return {
      ...normalizedPayload,
      id: telegramIdRaw
    };
  }

  async resolveAdminFromTelegramAuth(telegramAuth = {}) {
    let telegramId;
    try {
      telegramId = BigInt(telegramAuth.id);
    } catch (_error) {
      throw new ValidationError('Telegram auth payload has invalid id');
    }

    const existingLinkedAdmin = await prisma.admin.findUnique({
      where: { telegramId }
    });
    if (existingLinkedAdmin) {
      return existingLinkedAdmin;
    }

    if (!env.TELEGRAM_OAUTH_LINK_BY_USERNAME || !telegramAuth.username) {
      throw new UnauthorizedError('Telegram account is not linked to any admin');
    }

    const username = String(telegramAuth.username).trim();
    if (!username) {
      throw new UnauthorizedError('Telegram account is not linked to any admin');
    }

    const candidateAdmin = await prisma.admin.findUnique({
      where: { username }
    });
    if (!candidateAdmin) {
      throw new UnauthorizedError('Telegram account is not linked to any admin');
    }

    if (candidateAdmin.telegramId && candidateAdmin.telegramId !== telegramId) {
      throw new UnauthorizedError('Admin account is linked to a different Telegram identity');
    }

    return prisma.admin.update({
      where: { id: candidateAdmin.id },
      data: {
        telegramId
      }
    });
  }

  async issueLoginSession(admin, { ipAddress = '', userAgent = '' } = {}) {
    await this.resetFailedLogin(admin.id);

    const updatedAdmin = await prisma.admin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() }
    });

    const { refreshToken, sessionId } = await this.createSession(updatedAdmin, { ipAddress, userAgent });
    const token = this.signAccessToken(updatedAdmin, sessionId);

    return {
      token,
      refreshToken,
      admin: {
        id: updatedAdmin.id,
        username: updatedAdmin.username,
        role: updatedAdmin.role,
        email: updatedAdmin.email,
        twoFactorEnabled: updatedAdmin.twoFactorEnabled
      }
    };
  }

  getTelegramOAuthConfig() {
    const enabled =
      env.TELEGRAM_OAUTH_ENABLED &&
      Boolean(env.TELEGRAM_BOT_TOKEN) &&
      Boolean(env.TELEGRAM_BOT_USERNAME);
    return {
      enabled,
      botUsername: enabled ? env.TELEGRAM_BOT_USERNAME : ''
    };
  }

  async login(username, password, options = {}) {
    const { ipAddress = '', userAgent = '', otp = '' } = options;
    const admin = await prisma.admin.findUnique({
      where: { username }
    });

    if (!admin) {
      throw new UnauthorizedError('Invalid credentials');
    }

    if (!this.isAdminIpAllowed(ipAddress)) {
      throw new ForbiddenError('Login from this IP is not allowed');
    }

    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new UnauthorizedError('Account temporarily locked due to failed login attempts');
    }

    const isValid = await bcrypt.compare(password, admin.password);
    if (!isValid) {
      await this.registerFailedLogin(admin);
      throw new UnauthorizedError('Invalid credentials');
    }

    // If 2FA is required for SUPER_ADMIN but not yet set up, allow login
    // but flag the response so the frontend can redirect to 2FA setup.
    const needsTwoFactorSetup = this.isSuperAdmin2FARequired() && admin.role === 'SUPER_ADMIN' && !admin.twoFactorEnabled;

    if (admin.twoFactorEnabled) {
      if (!otp) {
        await this.registerFailedLogin(admin);
        throw new UnauthorizedError('Two-factor code is required');
      }

      const twoFactorSecret = this.getTotpSecret(admin);
      const isOtpValid = totpService.verifyOtp(twoFactorSecret, otp);
      if (!isOtpValid) {
        await this.registerFailedLogin(admin);
        throw new UnauthorizedError('Invalid two-factor code');
      }
    }

    const session = await this.issueLoginSession(admin, { ipAddress, userAgent });
    if (needsTwoFactorSetup) {
      session.requiresTwoFactorSetup = true;
    }
    return session;
  }

  async loginWithTelegram(payload, options = {}) {
    const { ipAddress = '', userAgent = '', otp = '' } = options;
    const telegramAuth = this.verifyTelegramAuthPayload(payload);
    const admin = await this.resolveAdminFromTelegramAuth(telegramAuth);

    if (!this.isAdminIpAllowed(ipAddress)) {
      throw new ForbiddenError('Login from this IP is not allowed');
    }

    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new UnauthorizedError('Account temporarily locked due to failed login attempts');
    }

    const needsTwoFactorSetup = this.isSuperAdmin2FARequired() && admin.role === 'SUPER_ADMIN' && !admin.twoFactorEnabled;

    if (admin.twoFactorEnabled) {
      if (!otp) {
        throw new UnauthorizedError('Two-factor code is required');
      }

      const twoFactorSecret = this.getTotpSecret(admin);
      const isOtpValid = totpService.verifyOtp(twoFactorSecret, otp);
      if (!isOtpValid) {
        throw new UnauthorizedError('Invalid two-factor code');
      }
    }

    const session = await this.issueLoginSession(admin, { ipAddress, userAgent });
    if (needsTwoFactorSetup) {
      session.requiresTwoFactorSetup = true;
    }
    return session;
  }

  async refreshSession(refreshToken, options = {}) {
    const { ipAddress = '', userAgent = '' } = options;

    if (!this.isAdminIpAllowed(ipAddress)) {
      throw new ForbiddenError('Refresh from this IP is not allowed');
    }

    const payload = this.verifyRefreshToken(refreshToken);

    const session = await prisma.adminSession.findUnique({
      where: { jti: payload.sid },
      include: { admin: true }
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedError('Session expired');
    }

    if (session.tokenHash !== hashToken(refreshToken)) {
      const now = new Date();
      await prisma.adminSession.updateMany({
        where: {
          adminId: session.adminId,
          revokedAt: null
        },
        data: {
          revokedAt: now,
          lastUsedAt: now
        }
      });

      logger.warn('Refresh token replay detected; revoked all sessions', {
        adminId: session.adminId,
        sessionId: session.jti,
        ipAddress
      });

      throw new UnauthorizedError('Session mismatch');
    }

    if (this.isStrictSessionBindingEnabled()) {
      const sessionIp = session.ipAddress ? String(session.ipAddress) : '';
      const requestIp = ipAddress ? String(ipAddress) : '';
      if (sessionIp && requestIp && sessionIp !== requestIp) {
        await prisma.adminSession.update({
          where: { id: session.id },
          data: {
            revokedAt: new Date(),
            lastUsedAt: new Date()
          }
        });
        throw new UnauthorizedError('Session context changed');
      }
    }

    if (session.admin.lockedUntil && session.admin.lockedUntil > new Date()) {
      throw new UnauthorizedError('Account temporarily locked');
    }

    const rotatedRefreshToken = this.signRefreshToken(session.admin, session.jti);
    const decoded = jwt.decode(rotatedRefreshToken);
    if (!decoded || typeof decoded.exp !== 'number') {
      throw new UnauthorizedError('Failed to rotate session');
    }

    await prisma.adminSession.update({
      where: { id: session.id },
      data: {
        tokenHash: hashToken(rotatedRefreshToken),
        ipAddress: ipAddress || session.ipAddress,
        userAgent: userAgent || session.userAgent,
        expiresAt: secondsToDate(decoded.exp),
        lastUsedAt: new Date()
      }
    });

    return {
      token: this.signAccessToken(session.admin, session.jti),
      refreshToken: rotatedRefreshToken,
      admin: {
        id: session.admin.id,
        username: session.admin.username,
        role: session.admin.role,
        email: session.admin.email,
        twoFactorEnabled: session.admin.twoFactorEnabled
      }
    };
  }

  async revokeSession(refreshToken) {
    const payload = this.verifyRefreshToken(refreshToken);
    const tokenHash = hashToken(refreshToken);

    const session = await prisma.adminSession.findUnique({
      where: { jti: payload.sid }
    });

    if (!session || session.revokedAt || session.tokenHash !== tokenHash) {
      return false;
    }

    await prisma.adminSession.update({
      where: { id: session.id },
      data: {
        revokedAt: new Date(),
        lastUsedAt: new Date()
      }
    });

    return true;
  }

  async revokeAllSessions(adminId) {
    const parsedAdminId = Number.parseInt(adminId, 10);
    if (Number.isNaN(parsedAdminId)) {
      throw new ValidationError('Invalid admin id');
    }

    await prisma.adminSession.updateMany({
      where: {
        adminId: parsedAdminId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });
  }

  async assertActiveSession(adminId, sessionId) {
    const parsedAdminId = Number.parseInt(adminId, 10);
    const normalizedSessionId = String(sessionId || '').trim();

    if (Number.isNaN(parsedAdminId) || parsedAdminId < 1) {
      throw new UnauthorizedError('Invalid admin identity');
    }

    if (!normalizedSessionId) {
      throw new UnauthorizedError('Session context missing');
    }

    const session = await prisma.adminSession.findUnique({
      where: { jti: normalizedSessionId },
      select: {
        adminId: true,
        revokedAt: true,
        expiresAt: true
      }
    });

    if (!session || session.adminId !== parsedAdminId) {
      throw new UnauthorizedError('Session not found');
    }

    if (session.revokedAt) {
      throw new UnauthorizedError('Session has been revoked');
    }

    if (session.expiresAt <= new Date()) {
      throw new UnauthorizedError('Session has expired');
    }

    return true;
  }

  async listAdminSessions(adminId, options = {}) {
    const parsedAdminId = Number.parseInt(adminId, 10);
    if (Number.isNaN(parsedAdminId) || parsedAdminId < 1) {
      throw new UnauthorizedError('Invalid admin identity');
    }

    const includeRevoked = parseBoolean(options.includeRevoked, false);
    const limitRaw = Number.parseInt(options.limit, 10);
    const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;
    const currentSessionId = String(options.currentSessionId || '').trim();
    const now = new Date();

    const rows = await prisma.adminSession.findMany({
      where: {
        adminId: parsedAdminId,
        ...(includeRevoked ? {} : { revokedAt: null }),
        expiresAt: {
          gt: now
        }
      },
      orderBy: [
        { lastUsedAt: 'desc' },
        { createdAt: 'desc' }
      ],
      take: limit
    });

    return rows.map((session) => ({
      id: session.id,
      sessionId: session.jti,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      current: Boolean(currentSessionId) && session.jti === currentSessionId
    }));
  }

  async revokeSessionById(adminId, sessionId, options = {}) {
    const parsedAdminId = Number.parseInt(adminId, 10);
    const normalizedSessionId = String(sessionId || '').trim();
    const currentSessionId = String(options.currentSessionId || '').trim();
    const allowCurrent = parseBoolean(options.allowCurrent, false);

    if (Number.isNaN(parsedAdminId) || parsedAdminId < 1) {
      throw new UnauthorizedError('Invalid admin identity');
    }

    if (!normalizedSessionId) {
      throw new ValidationError('sessionId is required');
    }

    if (!allowCurrent && currentSessionId && normalizedSessionId === currentSessionId) {
      throw new ValidationError('Cannot revoke current session with this action');
    }

    const session = await prisma.adminSession.findUnique({
      where: { jti: normalizedSessionId },
      select: {
        id: true,
        adminId: true,
        revokedAt: true,
        expiresAt: true
      }
    });

    if (!session || session.adminId !== parsedAdminId) {
      throw new UnauthorizedError('Session not found');
    }

    if (session.revokedAt || session.expiresAt <= new Date()) {
      return { revoked: false };
    }

    await prisma.adminSession.update({
      where: { id: session.id },
      data: {
        revokedAt: new Date(),
        lastUsedAt: new Date()
      }
    });

    return { revoked: true };
  }

  async createAdmin(username, password, role = 'ADMIN', email = null) {
    const existingAdmin = await prisma.admin.findUnique({
      where: { username },
      select: { id: true }
    });

    if (existingAdmin) {
      throw new ConflictError('Admin username already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    return prisma.admin.create({
      data: {
        username,
        password: hashedPassword,
        role,
        email,
        passwordChangedAt: new Date()
      }
    });
  }

  async setupTwoFactor(adminId) {
    const parsedAdminId = Number.parseInt(adminId, 10);
    if (Number.isNaN(parsedAdminId)) {
      throw new ValidationError('Invalid admin identity');
    }

    const admin = await prisma.admin.findUnique({
      where: { id: parsedAdminId }
    });
    if (!admin) {
      throw new UnauthorizedError('Admin not found');
    }

    const secret = totpService.generateSecret();
    const encryptedSecret = secretCryptoService.encrypt(secret);
    await prisma.admin.update({
      where: { id: parsedAdminId },
      data: {
        twoFactorSecret: encryptedSecret,
        twoFactorEnabled: false
      }
    });

    const issuer = 'One-UI';
    const otpAuthUrl = totpService.getOtpAuthUrl({
      issuer,
      accountName: admin.username,
      secret
    });

    return {
      secret,
      issuer,
      otpAuthUrl
    };
  }

  async enableTwoFactor(adminId, otp) {
    const parsedAdminId = Number.parseInt(adminId, 10);
    if (Number.isNaN(parsedAdminId)) {
      throw new ValidationError('Invalid admin identity');
    }

    const admin = await prisma.admin.findUnique({
      where: { id: parsedAdminId }
    });
    if (!admin) {
      throw new UnauthorizedError('Admin not found');
    }
    if (!admin.twoFactorSecret) {
      throw new ValidationError('2FA setup not initialized');
    }

    const twoFactorSecret = this.getTotpSecret(admin);
    const isValid = totpService.verifyOtp(twoFactorSecret, otp);
    if (!isValid) {
      throw new UnauthorizedError('Invalid two-factor code');
    }

    await prisma.admin.update({
      where: { id: parsedAdminId },
      data: { twoFactorEnabled: true }
    });

    return { enabled: true };
  }

  async disableTwoFactor(adminId, otp) {
    const parsedAdminId = Number.parseInt(adminId, 10);
    if (Number.isNaN(parsedAdminId)) {
      throw new ValidationError('Invalid admin identity');
    }

    const admin = await prisma.admin.findUnique({
      where: { id: parsedAdminId }
    });
    if (!admin) {
      throw new UnauthorizedError('Admin not found');
    }

    if (admin.twoFactorEnabled) {
      const twoFactorSecret = this.getTotpSecret(admin);
      const isValid = totpService.verifyOtp(twoFactorSecret, otp);
      if (!isValid) {
        throw new UnauthorizedError('Invalid two-factor code');
      }
    }

    await prisma.admin.update({
      where: { id: parsedAdminId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null
      }
    });

    return { enabled: false };
  }

  async hashPassword(password) {
    return bcrypt.hash(password, 10);
  }

  async comparePassword(password, hashedPassword) {
    return bcrypt.compare(password, hashedPassword);
  }

  validateUsername(username) {
    if (username.length < 3 || username.length > 32) {
      throw new ValidationError('Username must be between 3 and 32 characters');
    }

    if (!/^[A-Za-z0-9._-]+$/.test(username)) {
      throw new ValidationError(
        'Username can only contain letters, numbers, dot, underscore, and hyphen'
      );
    }
  }

  validateNextPassword(password) {
    if (password.length < 8 || password.length > 128) {
      throw new ValidationError('New password must be between 8 and 128 characters');
    }

    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      throw new ValidationError('New password must contain at least one letter and one number');
    }
  }

  async updateProfile(adminId, payload = {}) {
    const parsedAdminId = Number.parseInt(adminId, 10);
    if (Number.isNaN(parsedAdminId)) {
      throw new UnauthorizedError('Invalid admin identity');
    }

    const currentPassword = String(payload.currentPassword || '');
    if (!currentPassword.trim()) {
      throw new ValidationError('Current password is required');
    }

    const admin = await prisma.admin.findUnique({
      where: { id: parsedAdminId },
      select: {
        id: true,
        username: true,
        password: true,
        role: true,
        email: true,
        twoFactorEnabled: true
      }
    });
    if (!admin) {
      throw new UnauthorizedError('Admin not found');
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, admin.password);
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    const updateData = {};
    let usernameChanged = false;
    let passwordChanged = false;

    if (typeof payload.username === 'string') {
      const normalizedUsername = payload.username.trim();
      if (normalizedUsername && normalizedUsername !== admin.username) {
        this.validateUsername(normalizedUsername);

        const existingAdmin = await prisma.admin.findUnique({
          where: { username: normalizedUsername },
          select: { id: true }
        });

        if (existingAdmin && existingAdmin.id !== parsedAdminId) {
          throw new ConflictError('Username is already in use');
        }

        updateData.username = normalizedUsername;
        usernameChanged = true;
      }
    }

    const hasNewPassword = typeof payload.newPassword === 'string' && payload.newPassword.length > 0;
    if (hasNewPassword) {
      const nextPassword = payload.newPassword;
      const confirmPassword = typeof payload.confirmPassword === 'string' ? payload.confirmPassword : '';

      if (nextPassword !== confirmPassword) {
        throw new ValidationError('New password and confirm password do not match');
      }

      this.validateNextPassword(nextPassword);

      const isSamePassword = await bcrypt.compare(nextPassword, admin.password);
      if (isSamePassword) {
        throw new ValidationError('New password must be different from current password');
      }

      updateData.password = await bcrypt.hash(nextPassword, 12);
      updateData.passwordChangedAt = new Date();
      passwordChanged = true;
    }

    if (!usernameChanged && !passwordChanged) {
      throw new ValidationError('No profile changes submitted');
    }

    const now = new Date();
    const updatedAdmin = await prisma.$transaction(async (tx) => {
      const updated = await tx.admin.update({
        where: { id: parsedAdminId },
        data: updateData,
        select: {
          id: true,
          username: true,
          role: true,
          email: true,
          twoFactorEnabled: true,
          passwordChangedAt: true,
          updatedAt: true
        }
      });

      if (passwordChanged) {
        await tx.adminSession.updateMany({
          where: {
            adminId: parsedAdminId,
            revokedAt: null
          },
          data: {
            revokedAt: now,
            lastUsedAt: now
          }
        });
      }

      return updated;
    });

    return {
      ...updatedAdmin,
      usernameChanged,
      passwordChanged,
      sessionsRevoked: passwordChanged
    };
  }

  async getCurrentAdmin(adminId) {
    const parsedAdminId = Number.parseInt(adminId, 10);

    if (Number.isNaN(parsedAdminId)) {
      throw new UnauthorizedError('Invalid admin identity');
    }

    const admin = await prisma.admin.findUnique({ where: { id: parsedAdminId } });

    if (!admin) {
      throw new UnauthorizedError('Admin not found');
    }

    return {
      id: admin.id,
      username: admin.username,
      email: admin.email,
      role: admin.role,
      telegramId: admin.telegramId,
      lastLoginAt: admin.lastLoginAt,
      twoFactorEnabled: admin.twoFactorEnabled,
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt
    };
  }

  async getTelegramLink(adminId) {
    const parsedAdminId = Number.parseInt(adminId, 10);
    if (Number.isNaN(parsedAdminId)) {
      throw new UnauthorizedError('Invalid admin identity');
    }

    const admin = await prisma.admin.findUnique({
      where: { id: parsedAdminId },
      select: {
        id: true,
        username: true,
        telegramId: true
      }
    });

    if (!admin) {
      throw new UnauthorizedError('Admin not found');
    }

    return {
      linked: Boolean(admin.telegramId),
      telegramId: admin.telegramId ? admin.telegramId.toString() : null,
      username: admin.username
    };
  }

  async linkTelegramAccount(adminId, telegramIdInput) {
    const parsedAdminId = Number.parseInt(adminId, 10);
    if (Number.isNaN(parsedAdminId)) {
      throw new UnauthorizedError('Invalid admin identity');
    }

    let telegramId;
    try {
      telegramId = BigInt(String(telegramIdInput).trim());
    } catch (_error) {
      throw new ValidationError('Invalid Telegram ID format');
    }

    const existing = await prisma.admin.findUnique({
      where: { telegramId },
      select: { id: true, username: true }
    });

    if (existing && existing.id !== parsedAdminId) {
      throw new ConflictError(`Telegram ID is already linked to admin "${existing.username}"`);
    }

    const updated = await prisma.admin.update({
      where: { id: parsedAdminId },
      data: { telegramId },
      select: {
        id: true,
        username: true,
        telegramId: true
      }
    });

    return {
      linked: true,
      telegramId: updated.telegramId ? updated.telegramId.toString() : null,
      username: updated.username
    };
  }

  async unlinkTelegramAccount(adminId) {
    const parsedAdminId = Number.parseInt(adminId, 10);
    if (Number.isNaN(parsedAdminId)) {
      throw new UnauthorizedError('Invalid admin identity');
    }

    const updated = await prisma.admin.update({
      where: { id: parsedAdminId },
      data: { telegramId: null },
      select: {
        id: true,
        username: true
      }
    });

    return {
      linked: false,
      telegramId: null,
      username: updated.username
    };
  }
}

module.exports = new AuthService();
