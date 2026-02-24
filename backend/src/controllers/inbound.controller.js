const inboundService = require('../services/inbound.service');
const webhookService = require('../services/webhook.service');
const { sendSuccess } = require('../utils/response');
const { scheduleXrayReload } = require('../utils/xrayReloadQueue');

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

async function listInbounds(req, res, next) {
  try {
    const result = await inboundService.listInbounds({
      page: req.query.page,
      limit: req.query.limit
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Inbounds retrieved successfully',
      data: result.inbounds,
      meta: result.pagination
    });
  } catch (error) {
    return next(error);
  }
}

async function getInbound(req, res, next) {
  try {
    const inbound = await inboundService.getInboundById(req.params.id);

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Inbound retrieved successfully',
      data: inbound
    });
  } catch (error) {
    return next(error);
  }
}

async function getInboundsHealthSummary(req, res, next) {
  try {
    const rawIds = req.query.ids;
    const ids = String(Array.isArray(rawIds) ? rawIds.join(',') : (rawIds || ''))
      .split(',')
      .map((entry) => Number.parseInt(entry.trim(), 10))
      .filter((entry) => Number.isInteger(entry) && entry > 0);

    const data = await inboundService.getInboundsHealthSummary({
      ids,
      timeoutMs: req.query.timeoutMs
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Inbound health summary retrieved successfully',
      data
    });
  } catch (error) {
    return next(error);
  }
}

async function getInboundClientTemplates(req, res, next) {
  try {
    const payload = await inboundService.getInboundClientTemplates(req.params.id, {
      userId: req.query.userId,
      preset: req.query.preset
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Inbound client templates generated successfully',
      data: payload
    });
  } catch (error) {
    return next(error);
  }
}

async function downloadInboundClientTemplatePack(req, res, next) {
  try {
    const pack = await inboundService.getInboundClientTemplatePack(req.params.id, {
      userId: req.query.userId,
      preset: req.query.preset
    });

    res.setHeader('Content-Type', pack.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${pack.filename}"`);
    res.setHeader('Content-Length', String(pack.size));
    return res.status(200).send(pack.buffer);
  } catch (error) {
    return next(error);
  }
}

async function downloadInboundAllUsersClientTemplatePack(req, res, next) {
  try {
    const pack = await inboundService.getInboundAllUsersClientTemplatePack(req.params.id, {
      preset: req.query.preset
    });

    res.setHeader('Content-Type', pack.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${pack.filename}"`);
    res.setHeader('Content-Length', String(pack.size));
    return res.status(200).send(pack.buffer);
  } catch (error) {
    return next(error);
  }
}

async function generateWireguardKeys(req, res, next) {
  try {
    const keys = await inboundService.generateWireguardKeyPair();

    return sendSuccess(res, {
      statusCode: 200,
      message: 'WireGuard key pair generated successfully',
      data: keys
    });
  } catch (error) {
    return next(error);
  }
}

async function generateRealityKeys(req, res, next) {
  try {
    const bundle = await inboundService.generateRealityKeyBundle({
      count: req.query.count,
      serverName: req.query.serverName
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: 'REALITY key bundle generated successfully',
      data: bundle
    });
  } catch (error) {
    return next(error);
  }
}

async function getRandomPort(req, res, next) {
  try {
    const payload = await inboundService.suggestRandomPort({
      min: req.query.min,
      max: req.query.max
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Random port generated successfully',
      data: payload
    });
  } catch (error) {
    return next(error);
  }
}

async function assignRandomPort(req, res, next) {
  try {
    const inbound = await inboundService.assignRandomPort(req.params.id, {
      min: req.query.min,
      max: req.query.max
    });

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'Inbound port randomized successfully',
      data: inbound
    });

    webhookService.emitEvent(
      'inbound.port.randomized',
      {
        id: inbound.id,
        tag: inbound.tag,
        port: inbound.port
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    scheduleXrayReload('inbound.port.randomized');
    return response;
  } catch (error) {
    return next(error);
  }
}

async function createInbound(req, res, next) {
  try {
    const inbound = await inboundService.createInbound(req.body);

    const response = sendSuccess(res, {
      statusCode: 201,
      message: 'Inbound created successfully',
      data: inbound
    });

    webhookService.emitEvent(
      'inbound.created',
      {
        id: inbound.id,
        tag: inbound.tag,
        protocol: inbound.protocol,
        port: inbound.port,
        enabled: inbound.enabled
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    scheduleXrayReload('inbound.created');
    return response;
  } catch (error) {
    return next(error);
  }
}

async function applyMyanmarPreset(req, res, next) {
  try {
    const result = await inboundService.createMyanmarResiliencePack(req.body || {});
    const dryRun = Boolean(result?.dryRun);

    const response = sendSuccess(res, {
      statusCode: dryRun ? 200 : 201,
      message: dryRun ? 'Myanmar resilience pack preview generated successfully' : 'Myanmar resilience pack applied successfully',
      data: result
    });

    webhookService.emitEvent(
      dryRun ? 'inbound.preset.myanmar.previewed' : 'inbound.preset.myanmar.applied',
      dryRun
        ? {
            plannedCount: result.planned?.length || 0,
            warnings: result.warnings || []
          }
        : {
            createdCount: result.created.length,
            inboundIds: result.created.map((inbound) => inbound.id),
            warnings: result.warnings
          },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    if (!dryRun) {
      scheduleXrayReload('inbound.preset.myanmar.applied');
    }
    return response;
  } catch (error) {
    return next(error);
  }
}

async function updateInbound(req, res, next) {
  try {
    const inbound = await inboundService.updateInbound(req.params.id, req.body);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'Inbound updated successfully',
      data: inbound
    });

    webhookService.emitEvent(
      'inbound.updated',
      {
        id: inbound.id,
        tag: inbound.tag,
        protocol: inbound.protocol,
        port: inbound.port,
        enabled: inbound.enabled,
        changedFields: Object.keys(req.body || {})
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    scheduleXrayReload('inbound.updated');
    return response;
  } catch (error) {
    return next(error);
  }
}

async function deleteInbound(req, res, next) {
  try {
    const result = await inboundService.deleteInbound(req.params.id);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'Inbound deleted successfully',
      data: result
    });

    webhookService.emitEvent(
      'inbound.deleted',
      {
        id: result.id
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    scheduleXrayReload('inbound.deleted');
    return response;
  } catch (error) {
    return next(error);
  }
}

async function bulkDeleteInbounds(req, res, next) {
  try {
    const result = await inboundService.bulkDeleteInbounds(req.body.inboundIds);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'Inbounds deleted successfully',
      data: result
    });

    webhookService.emitEvent(
      'inbound.bulk.deleted',
      {
        requestedCount: result.requestedCount,
        deletedCount: result.deletedCount
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    scheduleXrayReload('inbound.bulk.deleted');
    return response;
  } catch (error) {
    return next(error);
  }
}

async function bulkEnableInbounds(req, res, next) {
  try {
    const result = await inboundService.bulkSetEnabled(req.body.inboundIds, true);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'Inbounds enabled successfully',
      data: result
    });

    webhookService.emitEvent(
      'inbound.bulk.enabled',
      {
        requestedCount: result.requestedCount,
        updatedCount: result.updatedCount
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    scheduleXrayReload('inbound.bulk.enabled');
    return response;
  } catch (error) {
    return next(error);
  }
}

async function bulkDisableInbounds(req, res, next) {
  try {
    const result = await inboundService.bulkSetEnabled(req.body.inboundIds, false);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'Inbounds disabled successfully',
      data: result
    });

    webhookService.emitEvent(
      'inbound.bulk.disabled',
      {
        requestedCount: result.requestedCount,
        updatedCount: result.updatedCount
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    scheduleXrayReload('inbound.bulk.disabled');
    return response;
  } catch (error) {
    return next(error);
  }
}

async function toggleInbound(req, res, next) {
  try {
    const inbound = await inboundService.toggleInbound(req.params.id);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'Inbound toggled successfully',
      data: inbound
    });

    webhookService.emitEvent(
      'inbound.toggled',
      {
        id: inbound.id,
        tag: inbound.tag,
        enabled: inbound.enabled
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    scheduleXrayReload('inbound.toggled');
    return response;
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listInbounds,
  getInboundsHealthSummary,
  getInboundClientTemplates,
  downloadInboundClientTemplatePack,
  downloadInboundAllUsersClientTemplatePack,
  generateWireguardKeys,
  generateRealityKeys,
  getRandomPort,
  assignRandomPort,
  getInbound,
  createInbound,
  applyMyanmarPreset,
  bulkDeleteInbounds,
  bulkEnableInbounds,
  bulkDisableInbounds,
  updateInbound,
  deleteInbound,
  toggleInbound
};
