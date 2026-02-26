const logger = require('../config/logger');
const ApiResponse = require('../utils/response');
const mieruRuntimeService = require('../services/mieruRuntime.service');
const mieruSyncService = require('../services/mieruSync.service');
const mieruManagerService = require('../services/mieruManager.service');

async function getPolicy(_req, res, next) {
  try {
    const policy = mieruRuntimeService.getPolicy();
    res.json(ApiResponse.success(policy, 'Mieru integration policy'));
  } catch (error) {
    next(error);
  }
}

async function getStatus(_req, res, next) {
  try {
    const status = await mieruRuntimeService.getStatus();
    res.json(ApiResponse.success(status, 'Mieru runtime status'));
  } catch (error) {
    next(error);
  }
}

async function restart(req, res, next) {
  try {
    const result = await mieruRuntimeService.restart();

    logger.info('Mieru sidecar restart requested', {
      adminId: req.admin?.id,
      username: req.admin?.username,
      role: req.admin?.role
    });

    res.json(ApiResponse.success(result, result.message || 'Mieru sidecar restarted'));
  } catch (error) {
    next(error);
  }
}

async function getLogs(req, res, next) {
  try {
    const lineCount = Number.parseInt(String(req.query.lines || 120), 10);
    const logs = await mieruRuntimeService.getLogs(Number.isInteger(lineCount) ? lineCount : 120);
    res.json(ApiResponse.success(logs, 'Mieru runtime logs'));
  } catch (error) {
    next(error);
  }
}

async function sync(req, res, next) {
  try {
    const reason = req.body?.reason
      ? String(req.body.reason).slice(0, 120)
      : `api.mieru.sync.admin.${req.admin?.id || 'unknown'}`;

    const result = await mieruSyncService.syncUsers({
      reason,
      force: true
    });

    logger.info('Mieru users sync requested', {
      adminId: req.admin?.id,
      username: req.admin?.username,
      role: req.admin?.role,
      changed: result.changed,
      userCount: result.userCount,
      restarted: result.restarted,
      skipped: result.skipped
    });

    res.json(ApiResponse.success(result, result.changed ? 'Mieru users synced successfully' : 'Mieru users already in sync'));
  } catch (error) {
    next(error);
  }
}

async function getProfile(_req, res, next) {
  try {
    const profile = await mieruManagerService.getProfile();
    res.json(ApiResponse.success(profile, 'Mieru profile fetched successfully'));
  } catch (error) {
    next(error);
  }
}

async function updateProfile(req, res, next) {
  try {
    const profile = await mieruManagerService.updateProfile(req.body || {});

    logger.info('Mieru profile updated', {
      adminId: req.admin?.id,
      username: req.admin?.username,
      role: req.admin?.role,
      server: profile.server,
      portRange: profile.portRange
    });

    res.json(ApiResponse.success(profile, 'Mieru profile updated successfully'));
  } catch (error) {
    next(error);
  }
}

async function listUsers(req, res, next) {
  try {
    const includeOnline = String(req.query.includeOnline || 'true').toLowerCase() !== 'false';
    const result = await mieruManagerService.listUsers({ includeOnline });
    res.json(ApiResponse.success(result, 'Mieru users fetched successfully'));
  } catch (error) {
    next(error);
  }
}

async function createUser(req, res, next) {
  try {
    const result = await mieruManagerService.createCustomUser(req.body || {});

    logger.info('Mieru custom user created', {
      adminId: req.admin?.id,
      username: req.admin?.username,
      role: req.admin?.role,
      mieruUsername: result.user?.username
    });

    res.status(201).json(ApiResponse.success(result, 'Mieru user created successfully'));
  } catch (error) {
    next(error);
  }
}

async function updateUser(req, res, next) {
  try {
    const result = await mieruManagerService.updateCustomUser(req.params.username, req.body || {});

    logger.info('Mieru custom user updated', {
      adminId: req.admin?.id,
      username: req.admin?.username,
      role: req.admin?.role,
      mieruUsername: result.user?.username
    });

    res.json(ApiResponse.success(result, 'Mieru user updated successfully'));
  } catch (error) {
    next(error);
  }
}

async function deleteUser(req, res, next) {
  try {
    const result = await mieruManagerService.deleteCustomUser(req.params.username);

    logger.info('Mieru custom user deleted', {
      adminId: req.admin?.id,
      username: req.admin?.username,
      role: req.admin?.role,
      mieruUsername: result.username
    });

    res.json(ApiResponse.success(result, 'Mieru user deleted successfully'));
  } catch (error) {
    next(error);
  }
}

async function getOnlineSnapshot(_req, res, next) {
  try {
    const snapshot = await mieruManagerService.getOnlineSnapshot();
    res.json(ApiResponse.success(snapshot, 'Mieru online snapshot fetched successfully'));
  } catch (error) {
    next(error);
  }
}

async function exportUser(req, res, next) {
  try {
    const result = await mieruManagerService.getUserExport(req.params.username);
    res.json(ApiResponse.success(result, 'Mieru export generated successfully'));
  } catch (error) {
    next(error);
  }
}

async function getUserSubscriptionUrl(req, res, next) {
  try {
    const panelUser = await mieruManagerService.getPanelUserSubscription(req.params.username);
    const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
    const protocol = forwardedProto || req.protocol || 'http';
    const baseUrl = process.env.APP_URL || process.env.SUBSCRIPTION_URL || `${protocol}://${req.get('host')}`;
    const trimmedBaseUrl = String(baseUrl).replace(/\/+$/, '');

    const subscriptionUrl = `${trimmedBaseUrl}/sub/${panelUser.subscriptionToken}?target=mieru`;

    res.json(
      ApiResponse.success(
        {
          username: panelUser.email,
          email: panelUser.email,
          subscriptionToken: panelUser.subscriptionToken,
          subscriptionUrl
        },
        'Mieru subscription URL generated successfully'
      )
    );
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getPolicy,
  getStatus,
  restart,
  getLogs,
  sync,
  getProfile,
  updateProfile,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  getOnlineSnapshot,
  exportUser,
  getUserSubscriptionUrl
};
