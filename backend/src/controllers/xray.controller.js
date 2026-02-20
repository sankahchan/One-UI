const xrayManager = require('../xray/manager');
const configGenerator = require('../xray/config-generator');
const onlineTracker = require('../xray/online-tracker');
const xrayUpdateService = require('../services/xrayUpdate.service');
const xrayRoutingService = require('../services/xrayRouting.service');
const xrayGeodataService = require('../services/xrayGeodata.service');
const webhookService = require('../services/webhook.service');
const ApiResponse = require('../utils/response');
const logger = require('../config/logger');

function buildActorContext(req) {
  if (!req?.admin) {
    return null;
  }

  return {
    id: req.admin.id,
    username: req.admin.username,
    role: req.admin.role
  };
}

function buildRequestContext(req) {
  return {
    ip: req.ip,
    userAgent: req.get('user-agent') || ''
  };
}

class XrayController {
  async restart(req, res, next) {
    try {
      const result = await xrayManager.restart();

      // Log action
      logger.info({
        action: 'xray_restart',
        admin: req.admin.username,
        timestamp: new Date()
      });

      const response = res.json(ApiResponse.success(result));

      webhookService.emitEvent(
        'xray.restarted',
        {
          success: result.success,
          message: result.message
        },
        {
          actor: buildActorContext(req),
          request: buildRequestContext(req)
        }
      );

      return response;
    } catch (error) {
      next(error);
    }
  }

  async getStatus(req, res, next) {
    try {
      const [status, version] = await Promise.all([
        xrayManager.getStatus(),
        xrayManager.getVersion()
      ]);

      res.json(
        ApiResponse.success({
          running: status.running,
          version,
          mode: status.mode,
          state: status.state,
          deploymentHint: status.deploymentHint,
          hintMismatch: status.hintMismatch
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async getConfig(req, res, next) {
    try {
      const config = await configGenerator.generateConfig();
      res.json(ApiResponse.success(config));
    } catch (error) {
      next(error);
    }
  }

  async reloadConfig(req, res, next) {
    try {
      const result = await xrayManager.reloadConfig();

      logger.info({
        action: 'xray_config_reload',
        admin: req.admin.username,
        timestamp: new Date()
      });

      const response = res.json(ApiResponse.success(result));

      webhookService.emitEvent(
        'xray.config.reloaded',
        {
          success: result.success,
          inbounds: result.inbounds,
          configPath: result.configPath
        },
        {
          actor: buildActorContext(req),
          request: buildRequestContext(req)
        }
      );

      return response;
    } catch (error) {
      next(error);
    }
  }

  async getOnlineUsers(req, res, next) {
    try {
      const onlineUsers = await onlineTracker.getOnlineUsers();

      res.json(
        ApiResponse.success({
          count: onlineUsers.length,
          users: onlineUsers
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async getUpdatePolicy(_req, res, next) {
    try {
      const policy = await xrayUpdateService.getPolicy();
      res.json(ApiResponse.success(policy, 'Xray update policy'));
    } catch (error) {
      next(error);
    }
  }

  async getUpdatePreflight(_req, res, next) {
    try {
      const preflight = await xrayUpdateService.getPreflight();
      res.json(ApiResponse.success(preflight, 'Xray update preflight checks'));
    } catch (error) {
      next(error);
    }
  }

  async runCanaryUpdate(req, res, next) {
    try {
      const result = await xrayUpdateService.runUpdate({
        stage: 'canary',
        channel: req.body?.channel,
        image: req.body?.image,
        noRollback: req.body?.noRollback
      }, buildActorContext(req));

      res.json(ApiResponse.success(result, 'Xray canary update completed'));
    } catch (error) {
      next(error);
    }
  }

  async runFullUpdate(req, res, next) {
    try {
      const result = await xrayUpdateService.runUpdate({
        stage: 'full',
        channel: req.body?.channel,
        image: req.body?.image,
        noRollback: req.body?.noRollback,
        force: req.body?.force
      }, buildActorContext(req));

      res.json(ApiResponse.success(result, 'Xray full update completed'));
    } catch (error) {
      next(error);
    }
  }

  async getUpdateHistory(req, res, next) {
    try {
      const history = await xrayUpdateService.listHistory({
        page: req.query?.page,
        limit: req.query?.limit
      });

      res.json(ApiResponse.success(history.items, 'Xray update history', { pagination: history.pagination }));
    } catch (error) {
      next(error);
    }
  }

  async getUpdateBackups(_req, res, next) {
    try {
      const backups = await xrayUpdateService.listBackups();
      res.json(ApiResponse.success(backups, 'Xray rollback backups'));
    } catch (error) {
      next(error);
    }
  }

  async getUpdateReleaseIntel(req, res, next) {
    try {
      const forceRefresh =
        typeof req.query?.force === 'string'
          ? ['1', 'true', 'yes', 'on'].includes(req.query.force.toLowerCase())
          : Boolean(req.query?.force);

      const intel = await xrayUpdateService.getReleaseIntel({ forceRefresh });
      res.json(ApiResponse.success(intel, 'Xray release intelligence'));
    } catch (error) {
      next(error);
    }
  }

  async runRollbackUpdate(req, res, next) {
    try {
      const result = await xrayUpdateService.runUpdate({
        stage: 'rollback',
        backupTag: req.body?.backupTag
      }, buildActorContext(req));

      res.json(ApiResponse.success(result, 'Xray rollback completed'));
    } catch (error) {
      next(error);
    }
  }

  async forceUnlockUpdate(req, res, next) {
    try {
      const result = await xrayUpdateService.forceUnlock(
        buildActorContext(req),
        {
          reason: req.body?.reason,
          force: req.body?.force
        }
      );

      res.json(ApiResponse.success(result, result.message));
    } catch (error) {
      next(error);
    }
  }

  async runRuntimeDoctor(req, res, next) {
    try {
      const result = await xrayUpdateService.runRuntimeDoctor(
        {
          repair: req.body?.repair,
          source: req.body?.source || 'manual'
        },
        buildActorContext(req)
      );

      res.json(ApiResponse.success(result, result.ok ? 'Runtime doctor completed' : 'Runtime doctor found blocking issues'));
    } catch (error) {
      next(error);
    }
  }

  async createConfigSnapshot(_req, res, next) {
    try {
      const snapshot = await xrayManager.createCurrentSnapshot('manual');
      res.json(ApiResponse.success(snapshot, 'Config snapshot created'));
    } catch (error) {
      next(error);
    }
  }

  async getConfigSnapshots(req, res, next) {
    try {
      const limit = Number.parseInt(String(req.query?.limit || 50), 10);
      const snapshots = await xrayManager.listSnapshots(limit);
      res.json(ApiResponse.success(snapshots, 'Config snapshots retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async rollbackConfigSnapshot(req, res, next) {
    try {
      const result = await xrayManager.rollbackConfigSnapshot(req.body?.snapshotId, {
        applyMethod: req.body?.applyMethod || 'restart'
      });
      res.json(ApiResponse.success(result, 'Config snapshot rollback completed'));
    } catch (error) {
      next(error);
    }
  }

  async getRoutingProfile(_req, res, next) {
    try {
      const profile = await xrayRoutingService.getProfile();
      res.json(ApiResponse.success(profile, 'Routing profile retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async updateRoutingProfile(req, res, next) {
    try {
      const profile = await xrayRoutingService.setProfile(req.body || {});
      const apply = req.body?.apply === false ? null : await xrayManager.reloadConfig();
      res.json(ApiResponse.success({ profile, apply }, 'Routing profile updated'));
    } catch (error) {
      next(error);
    }
  }

  async syncConfDir(_req, res, next) {
    try {
      const result = await xrayManager.syncConfDir();
      res.json(ApiResponse.success(result, 'Confdir synchronized'));
    } catch (error) {
      next(error);
    }
  }

  async getConfDirStatus(_req, res, next) {
    try {
      const status = await xrayManager.getConfDirStatus();
      res.json(ApiResponse.success(status, 'Confdir status retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async getGeodataStatus(req, res, next) {
    try {
      const includeHash =
        typeof req.query?.includeHash === 'string'
          ? ['1', 'true', 'yes', 'on'].includes(req.query.includeHash.toLowerCase())
          : Boolean(req.query?.includeHash);
      const status = await xrayGeodataService.getStatus({ includeHash });
      res.json(ApiResponse.success(status, 'Geodata status retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async updateGeodata(req, res, next) {
    try {
      const result = await xrayGeodataService.update({
        useCommand: req.body?.useCommand,
        forceDownload: req.body?.forceDownload,
        command: req.body?.command
      });
      const reloaded = req.body?.reload === false ? null : await xrayManager.reloadConfig();
      res.json(ApiResponse.success({ result, reloaded }, 'Geodata updated'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new XrayController();
