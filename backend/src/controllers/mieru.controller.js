const logger = require('../config/logger');
const ApiResponse = require('../utils/response');
const mieruRuntimeService = require('../services/mieruRuntime.service');

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

module.exports = {
  getPolicy,
  getStatus,
  restart,
  getLogs
};
