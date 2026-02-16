const authService = require('../services/auth.service');
const securityAuditService = require('../services/securityAudit.service');
const webhookService = require('../services/webhook.service');
const metrics = require('../observability/metrics');
const { ValidationError } = require('../utils/errors');
const { sendSuccess } = require('../utils/response');

function buildRequestContext(req) {
  return {
    ip: req.ip,
    userAgent: req.get('user-agent') || ''
  };
}

function logSecurityEvent({ message, level = 'INFO', requestContext = {}, metadata = {} } = {}) {
  void securityAuditService.log({
    message,
    level,
    metadata: {
      ...requestContext,
      ...metadata
    }
  });
}

function classifyFailedLoginLevel(reason) {
  const text = String(reason || '').toLowerCase();
  if (text.includes('locked') || text.includes('ip is not allowed') || text.includes('expired')) {
    return 'CRITICAL';
  }
  return 'WARNING';
}

async function login(req, res, next) {
  try {
    const { username, password, otp } = req.body;
    const requestContext = buildRequestContext(req);
    const result = await authService.login(username, password, {
      otp,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || ''
    });

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'Login successful',
      data: result
    });
    metrics.recordAuthAttempt({
      method: 'password',
      success: true
    });

    webhookService.emitEvent(
      'auth.login.success',
      {
        admin: {
          id: result.admin.id,
          username: result.admin.username,
          role: result.admin.role
        }
      },
      {
        actor: {
          id: result.admin.id,
          username: result.admin.username,
          role: result.admin.role
        },
        request: requestContext
      }
    );

    logSecurityEvent({
      message: 'SECURITY_AUTH_LOGIN_SUCCESS',
      requestContext,
      metadata: {
        method: 'password',
        adminId: result.admin.id,
        username: result.admin.username,
        role: result.admin.role
      }
    });

    return response;
  } catch (error) {
    const requestContext = buildRequestContext(req);
    const reason = error.message || 'Login failed';
    metrics.recordAuthAttempt({
      method: 'password',
      success: false,
      reason
    });
    const severity = classifyFailedLoginLevel(reason);
    webhookService.emitEvent(
      'auth.login.failed',
      {
        username: req.body?.username || null,
        reason
      },
      {
        request: requestContext
      }
    );

    logSecurityEvent({
      message: 'SECURITY_AUTH_LOGIN_FAILED',
      level: severity,
      requestContext,
      metadata: {
        method: 'password',
        username: req.body?.username || null,
        reason
      }
    });

    return next(error);
  }
}

async function telegramConfig(_req, res, next) {
  try {
    return sendSuccess(res, {
      statusCode: 200,
      message: 'Telegram OAuth config',
      data: authService.getTelegramOAuthConfig()
    });
  } catch (error) {
    return next(error);
  }
}

async function loginTelegram(req, res, next) {
  try {
    const requestContext = buildRequestContext(req);
    const result = await authService.loginWithTelegram(req.body || {}, {
      otp: req.body?.otp || '',
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || ''
    });

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'Telegram login successful',
      data: result
    });
    metrics.recordAuthAttempt({
      method: 'telegram',
      success: true
    });

    webhookService.emitEvent(
      'auth.login.telegram.success',
      {
        admin: {
          id: result.admin.id,
          username: result.admin.username,
          role: result.admin.role
        }
      },
      {
        actor: {
          id: result.admin.id,
          username: result.admin.username,
          role: result.admin.role
        },
        request: requestContext
      }
    );

    logSecurityEvent({
      message: 'SECURITY_AUTH_LOGIN_TELEGRAM_SUCCESS',
      requestContext,
      metadata: {
        method: 'telegram',
        adminId: result.admin.id,
        username: result.admin.username,
        role: result.admin.role
      }
    });

    return response;
  } catch (error) {
    const requestContext = buildRequestContext(req);
    const reason = error.message || 'Telegram login failed';
    metrics.recordAuthAttempt({
      method: 'telegram',
      success: false,
      reason
    });
    const severity = classifyFailedLoginLevel(reason);
    webhookService.emitEvent(
      'auth.login.telegram.failed',
      {
        telegramId: req.body?.id || null,
        username: req.body?.username || null,
        reason
      },
      {
        request: requestContext
      }
    );

    logSecurityEvent({
      message: 'SECURITY_AUTH_LOGIN_TELEGRAM_FAILED',
      level: severity,
      requestContext,
      metadata: {
        method: 'telegram',
        telegramId: req.body?.id || null,
        username: req.body?.username || null,
        reason
      }
    });

    return next(error);
  }
}

async function getTelegramLink(req, res, next) {
  try {
    const data = await authService.getTelegramLink(req.admin.id);
    return sendSuccess(res, {
      statusCode: 200,
      message: 'Telegram link status',
      data
    });
  } catch (error) {
    return next(error);
  }
}

async function linkTelegram(req, res, next) {
  try {
    const data = await authService.linkTelegramAccount(req.admin.id, req.body?.telegramId);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'Telegram account linked',
      data
    });

    webhookService.emitEvent(
      'auth.telegram.linked',
      {
        adminId: req.admin.id,
        telegramId: data.telegramId
      },
      {
        actor: {
          id: req.admin.id,
          username: req.admin.username,
          role: req.admin.role
        },
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function unlinkTelegram(req, res, next) {
  try {
    const data = await authService.unlinkTelegramAccount(req.admin.id);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'Telegram account unlinked',
      data
    });

    webhookService.emitEvent(
      'auth.telegram.unlinked',
      {
        adminId: req.admin.id
      },
      {
        actor: {
          id: req.admin.id,
          username: req.admin.username,
          role: req.admin.role
        },
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function logout(_req, res, next) {
  try {
    const requestContext = buildRequestContext(_req);
    const refreshToken = _req.body?.refreshToken || _req.get('x-refresh-token');
    if (refreshToken) {
      await authService.revokeSession(refreshToken);
    }

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'Logout successful'
    });

    webhookService.emitEvent(
      'auth.logout',
      {
        adminId: _req.admin?.id || null
      },
      {
        actor: _req.admin
          ? {
              id: _req.admin.id,
              username: _req.admin.username,
              role: _req.admin.role
            }
          : null,
        request: requestContext
      }
    );

    logSecurityEvent({
      message: 'SECURITY_AUTH_LOGOUT',
      requestContext,
      metadata: {
        adminId: _req.admin?.id || null,
        username: _req.admin?.username || null
      }
    });

    return response;
  } catch (error) {
    return next(error);
  }
}

async function me(req, res, next) {
  try {
    const admin = await authService.getCurrentAdmin(req.admin.id);

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Authenticated admin profile',
      data: admin
    });
  } catch (error) {
    return next(error);
  }
}

async function updateProfile(req, res, next) {
  try {
    const requestContext = buildRequestContext(req);
    const result = await authService.updateProfile(req.admin.id, req.body || {});

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'Profile updated successfully',
      data: result
    });

    webhookService.emitEvent(
      'auth.profile.updated',
      {
        adminId: req.admin.id,
        username: result.username,
        usernameChanged: result.usernameChanged,
        passwordChanged: result.passwordChanged
      },
      {
        actor: {
          id: req.admin.id,
          username: result.username || req.admin.username,
          role: req.admin.role
        },
        request: requestContext
      }
    );

    if (result.passwordChanged) {
      webhookService.emitEvent(
        'auth.password.changed',
        {
          adminId: req.admin.id
        },
        {
          actor: {
            id: req.admin.id,
            username: result.username || req.admin.username,
            role: req.admin.role
          },
          request: requestContext
        }
      );
    }

    logSecurityEvent({
      message: 'SECURITY_AUTH_PROFILE_UPDATED',
      requestContext,
      metadata: {
        adminId: req.admin.id,
        username: result.username || req.admin.username,
        usernameChanged: Boolean(result.usernameChanged),
        passwordChanged: Boolean(result.passwordChanged)
      }
    });

    return response;
  } catch (error) {
    return next(error);
  }
}

async function refresh(req, res, next) {
  try {
    const refreshToken = req.body?.refreshToken || req.get('x-refresh-token');
    if (!refreshToken) {
      throw new ValidationError('refreshToken is required');
    }

    const result = await authService.refreshSession(refreshToken, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || ''
    });

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'Session refreshed',
      data: result
    });
    metrics.recordAuthAttempt({
      method: 'refresh_token',
      success: true
    });

    webhookService.emitEvent(
      'auth.refresh',
      {
        admin: {
          id: result.admin.id,
          username: result.admin.username,
          role: result.admin.role
        }
      },
      {
        actor: {
          id: result.admin.id,
          username: result.admin.username,
          role: result.admin.role
        },
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    metrics.recordAuthAttempt({
      method: 'refresh_token',
      success: false,
      reason: error.message || 'Refresh failed'
    });
    return next(error);
  }
}

async function listSessions(req, res, next) {
  try {
    const sessions = await authService.listAdminSessions(req.admin.id, {
      currentSessionId: req.admin.sid,
      includeRevoked: req.query.includeRevoked,
      limit: req.query.limit
    });

    const activeCount = sessions.filter((session) => !session.revokedAt).length;

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Sessions retrieved',
      data: {
        total: sessions.length,
        active: activeCount,
        sessions
      }
    });
  } catch (error) {
    return next(error);
  }
}

async function revokeSessionById(req, res, next) {
  try {
    const requestContext = buildRequestContext(req);
    const result = await authService.revokeSessionById(req.admin.id, req.params.sid, {
      currentSessionId: req.admin.sid,
      allowCurrent: req.body?.allowCurrent
    });

    const response = sendSuccess(res, {
      statusCode: 200,
      message: result.revoked ? 'Session revoked' : 'Session already inactive',
      data: {
        sessionId: req.params.sid,
        ...result
      }
    });

    webhookService.emitEvent(
      'auth.session.revoked',
      {
        adminId: req.admin.id,
        sessionId: req.params.sid,
        revoked: result.revoked
      },
      {
        actor: {
          id: req.admin.id,
          username: req.admin.username,
          role: req.admin.role
        },
        request: requestContext
      }
    );

    logSecurityEvent({
      message: 'SECURITY_AUTH_SESSION_REVOKED',
      requestContext,
      metadata: {
        adminId: req.admin.id,
        username: req.admin.username,
        sessionId: req.params.sid,
        revoked: result.revoked
      }
    });

    return response;
  } catch (error) {
    return next(error);
  }
}

async function logoutAll(req, res, next) {
  try {
    const requestContext = buildRequestContext(req);
    await authService.revokeAllSessions(req.admin.id);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'All sessions revoked'
    });

    webhookService.emitEvent(
      'auth.logout_all',
      {
        adminId: req.admin.id
      },
      {
        actor: {
          id: req.admin.id,
          username: req.admin.username,
          role: req.admin.role
        },
        request: requestContext
      }
    );

    logSecurityEvent({
      message: 'SECURITY_AUTH_LOGOUT_ALL',
      requestContext,
      metadata: {
        adminId: req.admin.id,
        username: req.admin.username
      }
    });

    return response;
  } catch (error) {
    return next(error);
  }
}

async function setupTwoFactor(req, res, next) {
  try {
    const result = await authService.setupTwoFactor(req.admin.id);

    return sendSuccess(res, {
      statusCode: 200,
      message: '2FA setup generated',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

async function enableTwoFactor(req, res, next) {
  try {
    const requestContext = buildRequestContext(req);
    const { otp } = req.body;
    const result = await authService.enableTwoFactor(req.admin.id, otp);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: '2FA enabled',
      data: result
    });

    webhookService.emitEvent(
      'auth.2fa.enabled',
      {
        adminId: req.admin.id
      },
      {
        actor: {
          id: req.admin.id,
          username: req.admin.username,
          role: req.admin.role
        },
        request: requestContext
      }
    );

    logSecurityEvent({
      message: 'SECURITY_AUTH_2FA_ENABLED',
      requestContext,
      metadata: {
        adminId: req.admin.id,
        username: req.admin.username
      }
    });

    return response;
  } catch (error) {
    return next(error);
  }
}

async function disableTwoFactor(req, res, next) {
  try {
    const requestContext = buildRequestContext(req);
    const { otp } = req.body;
    const result = await authService.disableTwoFactor(req.admin.id, otp);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: '2FA disabled',
      data: result
    });

    webhookService.emitEvent(
      'auth.2fa.disabled',
      {
        adminId: req.admin.id
      },
      {
        actor: {
          id: req.admin.id,
          username: req.admin.username,
          role: req.admin.role
        },
        request: requestContext
      }
    );

    logSecurityEvent({
      message: 'SECURITY_AUTH_2FA_DISABLED',
      level: 'WARNING',
      requestContext,
      metadata: {
        adminId: req.admin.id,
        username: req.admin.username
      }
    });

    return response;
  } catch (error) {
    return next(error);
  }
}

async function loginInfo(_req, res, next) {
  try {
    return sendSuccess(res, {
      statusCode: 200,
      message: 'Login info',
      data: {
        requireTwoFactorForSuperAdmin: authService.isSuperAdmin2FARequired()
      }
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  login,
  loginTelegram,
  telegramConfig,
  loginInfo,
  getTelegramLink,
  linkTelegram,
  unlinkTelegram,
  logout,
  me,
  updateProfile,
  refresh,
  listSessions,
  revokeSessionById,
  logoutAll,
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor
};
