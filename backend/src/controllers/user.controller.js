const prisma = require('../config/database');
const userService = require('../services/user.service');
const groupService = require('../services/group.service');
const webhookService = require('../services/webhook.service');
const subscriptionBrandingService = require('../services/subscriptionBranding.service');
const { buildProtocolUrl } = require('../subscription/formats/url-builder');
const QRCode = require('qrcode');
const ApiResponse = require('../utils/response');
const { sendSuccess } = require('../utils/response');

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

async function listUsers(req, res, next) {
  try {
    const result = await userService.listUsers({
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      search: req.query.search
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Users retrieved successfully',
      data: result.users,
      meta: result.pagination
    });
  } catch (error) {
    return next(error);
  }
}

async function getSessionSnapshots(req, res, next) {
  try {
    const rawUserIds = typeof req.query.userIds === 'string' ? req.query.userIds : '';
    const userIds = rawUserIds
      .split(',')
      .map((entry) => Number.parseInt(entry.trim(), 10))
      .filter((value) => Number.isInteger(value) && value > 0);

    const includeOffline =
      typeof req.query.includeOffline === 'boolean'
        ? req.query.includeOffline
        : String(req.query.includeOffline || '').toLowerCase() !== 'false';

    const result = await userService.getSessionSnapshots({
      userIds,
      includeOffline,
      limit: req.query.limit
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: 'User sessions retrieved successfully',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

async function streamSessionSnapshots(req, res, next) {
  try {
    const rawUserIds = typeof req.query.userIds === 'string' ? req.query.userIds : '';
    const userIds = rawUserIds
      .split(',')
      .map((entry) => Number.parseInt(entry.trim(), 10))
      .filter((value) => Number.isInteger(value) && value > 0);

    const includeOffline =
      typeof req.query.includeOffline === 'boolean'
        ? req.query.includeOffline
        : String(req.query.includeOffline || '').toLowerCase() !== 'false';

    const intervalRaw = Number.parseInt(String(req.query.interval || 2000), 10);
    const intervalMs = Number.isInteger(intervalRaw) ? Math.min(Math.max(intervalRaw, 500), 10000) : 2000;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const writeEvent = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let running = false;
    const pushSnapshot = async () => {
      if (running) {
        return;
      }

      running = true;
      try {
        const snapshot = await userService.getSessionSnapshots({
          userIds,
          includeOffline,
          limit: req.query.limit
        });

        writeEvent('snapshot', snapshot);
      } catch (error) {
        writeEvent('error', { message: error.message || 'Failed to stream user sessions' });
      } finally {
        running = false;
      }
    };

    await pushSnapshot();

    const intervalId = setInterval(() => {
      void pushSnapshot();
    }, intervalMs);

    const heartbeatId = setInterval(() => {
      res.write(': ping\n\n');
    }, 20_000);

    req.on('close', () => {
      clearInterval(intervalId);
      clearInterval(heartbeatId);
      res.end();
    });
  } catch (error) {
    return next(error);
  }
}

async function getUserSessionSnapshot(req, res, next) {
  try {
    const result = await userService.getUserSessionSnapshot(req.params.id);

    return sendSuccess(res, {
      statusCode: 200,
      message: 'User session retrieved successfully',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

async function getUser(req, res, next) {
  try {
    const user = await userService.getUserById(req.params.id);

    return sendSuccess(res, {
      statusCode: 200,
      message: 'User retrieved successfully',
      data: user
    });
  } catch (error) {
    return next(error);
  }
}

async function createUser(req, res, next) {
  try {
    const user = await userService.createUser(req.body);

    const response = sendSuccess(res, {
      statusCode: 201,
      message: 'User created successfully',
      data: user
    });

    webhookService.emitEvent(
      'user.created',
      {
        id: user.id,
        email: user.email,
        status: user.status,
        dataLimit: user.dataLimit
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function updateUser(req, res, next) {
  try {
    const user = await userService.updateUser(req.params.id, req.body);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User updated successfully',
      data: user
    });

    webhookService.emitEvent(
      'user.updated',
      {
        id: user.id,
        email: user.email,
        status: user.status,
        changedFields: Object.keys(req.body || {})
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
      webhookService.emitEvent(
        'user.status.changed',
        {
          id: user.id,
          email: user.email,
          status: user.status
        },
        {
          actor: buildActorContext(req),
          request: buildRequestContext(req)
        }
      );
    }

    return response;
  } catch (error) {
    return next(error);
  }
}

async function deleteUser(req, res, next) {
  try {
    const result = await userService.deleteUser(req.params.id);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User deleted successfully',
      data: result
    });

    webhookService.emitEvent(
      'user.deleted',
      {
        id: result.id
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function getSubscriptionInfo(req, res, next) {
  try {
    const { id } = req.params;
    const user = await userService.getUserById(id);

    const baseUrl = process.env.SUBSCRIPTION_URL || `${req.protocol}://${req.get('host')}`;
    const subscriptionUrl = `${baseUrl}/sub/${user.subscriptionToken}`;

    const [v2rayQr, clashQr, singboxQr, wireguardQr] = await Promise.all([
      QRCode.toDataURL(`${subscriptionUrl}?target=v2ray`),
      QRCode.toDataURL(`${subscriptionUrl}?target=clash`),
      QRCode.toDataURL(`${subscriptionUrl}?target=singbox`),
      QRCode.toDataURL(`${subscriptionUrl}?target=wireguard`)
    ]);

    const userWithInbounds = await prisma.user.findUnique({
      where: { id: Number(id) },
      include: {
        inbounds: {
          where: {
            enabled: true,
            inbound: { enabled: true }
          },
          include: { inbound: true }
        }
      }
    });

    const links = userWithInbounds
      ? (
          await Promise.all(
            userWithInbounds.inbounds.map(async (userInbound) => {
              const inbound = userInbound.inbound;
              const url = buildProtocolUrl(inbound.protocol, user, inbound);
              if (!url) {
                return null;
              }

              const qrCode = await QRCode.toDataURL(url);
              return {
                inboundId: inbound.id,
                remark: inbound.remark || `${user.email}-${inbound.protocol}`,
                protocol: inbound.protocol,
                network: inbound.network,
                security: inbound.security || 'NONE',
                url,
                qrCode
              };
            })
          )
        ).filter(Boolean)
      : [];

    const shareUrl = `${baseUrl}/user/${user.subscriptionToken}`;
    const branding = await subscriptionBrandingService.resolveEffectiveBrandingForUser(user.id);

    return res.json(
      ApiResponse.success({
        urls: {
          v2ray: `${subscriptionUrl}?target=v2ray`,
          clash: `${subscriptionUrl}?target=clash`,
          singbox: `${subscriptionUrl}?target=singbox`,
          wireguard: `${subscriptionUrl}?target=wireguard`
        },
        qrCodes: {
          v2ray: v2rayQr,
          clash: clashQr,
          singbox: singboxQr,
          wireguard: wireguardQr
        },
        token: user.subscriptionToken,
        links,
        shareUrl,
        branding: branding
          ? {
              appName: branding.appName || 'One-UI',
              logoUrl: branding.logoUrl || null,
              primaryColor: branding.primaryColor || null,
              accentColor: branding.accentColor || null,
              profileTitle: branding.profileTitle || null,
              profileDescription: branding.profileDescription || null,
              supportUrl: branding.supportUrl || null,
              customFooter: branding.customFooter || null,
              metadata: branding.metadata || null
            }
          : null
      })
    );
  } catch (error) {
    return next(error);
  }
}

async function getUserStats(req, res, next) {
  try {
    const stats = await userService.getUserStats();

    return sendSuccess(res, {
      statusCode: 200,
      message: 'User statistics retrieved successfully',
      data: stats
    });
  } catch (error) {
    return next(error);
  }
}

async function resetTraffic(req, res, next) {
  try {
    const user = await userService.resetTraffic(req.params.id);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User traffic reset successfully',
      data: user
    });

    webhookService.emitEvent(
      'user.traffic.reset',
      {
        id: user.id,
        email: user.email
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function extendExpiry(req, res, next) {
  try {
    const days = Number.parseInt(req.body.days, 10);
    const user = await userService.extendExpiry(req.params.id, Number.isInteger(days) ? days : 0);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User expiry extended successfully',
      data: user
    });

    webhookService.emitEvent(
      'user.expiry.extended',
      {
        id: user.id,
        email: user.email,
        days: Number.isInteger(days) ? days : 0,
        expireDate: user.expireDate
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function toggleUserInbound(req, res, next) {
  try {
    const enabled = typeof req.body.enabled === 'boolean' ? req.body.enabled : undefined;
    const relation = await userService.setUserInboundEnabled(req.params.id, req.params.inboundId, enabled);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User access key updated successfully',
      data: relation
    });

    webhookService.emitEvent(
      'user.key.toggled',
      {
        userId: Number.parseInt(req.params.id, 10),
        inboundId: Number.parseInt(req.params.inboundId, 10),
        enabled: relation.enabled,
        inboundTag: relation.inbound?.tag || null
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function updateUserInboundPriority(req, res, next) {
  try {
    const relation = await userService.setUserInboundPriority(
      req.params.id,
      req.params.inboundId,
      req.body.priority
    );

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User access key priority updated successfully',
      data: relation
    });

    webhookService.emitEvent(
      'user.key.priority.updated',
      {
        userId: Number.parseInt(req.params.id, 10),
        inboundId: Number.parseInt(req.params.inboundId, 10),
        priority: relation.priority
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function reorderUserInbounds(req, res, next) {
  try {
    const relations = await userService.reorderUserInbounds(req.params.id, req.body.assignments || []);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User access key order updated successfully',
      data: relations
    });

    webhookService.emitEvent(
      'user.key.order.updated',
      {
        userId: Number.parseInt(req.params.id, 10),
        assignments: req.body.assignments || []
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function previewUserInboundPatternReorder(req, res, next) {
  try {
    const result = await userService.getUserInboundPatternPreview(
      req.params.id,
      req.body?.pattern || 'myanmar'
    );

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User access key reorder preview generated successfully',
      data: result
    });

    webhookService.emitEvent(
      'user.key.order.pattern.previewed',
      {
        userId: Number.parseInt(req.params.id, 10),
        pattern: result.pattern,
        matchedKeys: result.matchedKeys,
        changedKeys: result.changedKeys
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function previewUserInboundQualityReorder(req, res, next) {
  try {
    const result = await userService.getUserInboundQualityPreview(req.params.id, {
      windowMinutes: req.body?.windowMinutes
    });

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User access key quality reorder preview generated successfully',
      data: result
    });

    webhookService.emitEvent(
      'user.key.order.quality.previewed',
      {
        userId: Number.parseInt(req.params.id, 10),
        windowMinutes: result.windowMinutes,
        totalKeys: result.totalKeys,
        scoredKeys: result.scoredKeys,
        changedKeys: result.changedKeys
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function reorderUserInboundsByPattern(req, res, next) {
  try {
    const dryRun = Boolean(req.body?.dryRun);
    const result = await userService.reorderUserInboundsByPattern(
      req.params.id,
      req.body?.pattern || 'myanmar',
      {
        dryRun
      }
    );

    const response = sendSuccess(res, {
      statusCode: 200,
      message: dryRun
        ? 'User access key reorder dry-run generated successfully'
        : 'User access key order updated successfully',
      data: result
    });

    webhookService.emitEvent(
      dryRun ? 'user.key.order.pattern.previewed' : 'user.key.order.pattern.updated',
      {
        userId: Number.parseInt(req.params.id, 10),
        pattern: result.pattern,
        matchedKeys: result.matchedKeys,
        changedKeys: result.changedKeys,
        dryRun
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function reorderUserInboundsByQuality(req, res, next) {
  try {
    const dryRun = Boolean(req.body?.dryRun);
    const result = await userService.reorderUserInboundsByQuality(req.params.id, {
      windowMinutes: req.body?.windowMinutes,
      dryRun
    });

    const response = sendSuccess(res, {
      statusCode: 200,
      message: dryRun
        ? 'User access key quality dry-run generated successfully'
        : 'User access key order updated successfully',
      data: result
    });

    webhookService.emitEvent(
      dryRun ? 'user.key.order.quality.previewed' : 'user.key.order.quality.updated',
      {
        userId: Number.parseInt(req.params.id, 10),
        windowMinutes: result.windowMinutes,
        totalKeys: result.totalKeys,
        scoredKeys: result.scoredKeys,
        changedKeys: result.changedKeys,
        dryRun
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function rotateUserKeys(req, res, next) {
  try {
    const user = await userService.rotateUserKeys(req.params.id, req.body || {});

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User keys rotated successfully',
      data: user
    });

    webhookService.emitEvent(
      'user.keys.rotated',
      {
        id: user.id,
        email: user.email,
        options: req.body || {}
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function revokeUserKeys(req, res, next) {
  try {
    const user = await userService.revokeUserKeys(req.params.id, req.body || {});

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User keys revoked successfully',
      data: user
    });

    webhookService.emitEvent(
      'user.keys.revoked',
      {
        id: user.id,
        email: user.email,
        options: req.body || {}
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function regenerateSubscriptionToken(req, res, next) {
  try {
    const payload = await userService.regenerateSubscriptionToken(req.params.id);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'Subscription token regenerated successfully',
      data: payload
    });

    webhookService.emitEvent(
      'user.subscription.regenerated',
      {
        id: payload.id,
        email: payload.email
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function getUserTraffic(req, res, next) {
  try {
    const logs = await userService.getUserTraffic(req.params.id, req.query.days);

    return sendSuccess(res, {
      statusCode: 200,
      message: 'User traffic logs retrieved successfully',
      data: logs
    });
  } catch (error) {
    return next(error);
  }
}

async function getUserDevices(req, res, next) {
  try {
    const devices = await userService.getUserDevices(req.params.id, {
      windowMinutes: req.query.windowMinutes
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: 'User devices retrieved successfully',
      data: devices
    });
  } catch (error) {
    return next(error);
  }
}

async function revokeUserDevice(req, res, next) {
  try {
    const result = await userService.revokeUserDevice(req.params.id, req.params.fingerprint);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User device revoked successfully',
      data: result
    });

    webhookService.emitEvent(
      'user.device.revoked',
      {
        userId: Number.parseInt(req.params.id, 10),
        fingerprint: req.params.fingerprint
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function disconnectUserSessions(req, res, next) {
  try {
    const result = await userService.disconnectUserSessions(req.params.id);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User sessions disconnected successfully',
      data: result
    });

    webhookService.emitEvent(
      'user.sessions.disconnected',
      {
        userId: Number.parseInt(req.params.id, 10),
        disconnectedDevices: result.disconnectedDevices,
        disconnectedIps: result.disconnectedIps
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function getUserActivity(req, res, next) {
  try {
    const activity = await userService.getUserActivity(req.params.id, {
      hours: req.query.hours,
      eventLimit: req.query.eventLimit,
      ipChurnThreshold: req.query.ipChurnThreshold,
      reconnectThreshold: req.query.reconnectThreshold,
      reconnectWindowMinutes: req.query.reconnectWindowMinutes,
      trafficSpikeFactor: req.query.trafficSpikeFactor,
      trafficSpikeMinBytes: req.query.trafficSpikeMinBytes
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: 'User activity retrieved successfully',
      data: activity
    });
  } catch (error) {
    return next(error);
  }
}

async function getEffectiveInbounds(req, res, next) {
  try {
    const result = await groupService.getUserEffectiveInbounds(req.params.id);

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Effective user inbounds retrieved successfully',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

async function getEffectivePolicy(req, res, next) {
  try {
    const result = await groupService.getUserEffectivePolicy(req.params.id);

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Effective user policy retrieved successfully',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

async function bulkDelete(req, res, next) {
  try {
    const result = await userService.bulkDelete(req.body.userIds);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'Users deleted successfully',
      data: result
    });

    webhookService.emitEvent(
      'user.bulk.deleted',
      {
        deletedCount: result.deletedCount,
        userIds: req.body.userIds || []
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function bulkCreate(req, res, next) {
  try {
    const result = await userService.bulkCreateUsers(req.body);

    const response = sendSuccess(res, {
      statusCode: 201,
      message: 'Bulk user provisioning completed',
      data: result
    });

    webhookService.emitEvent(
      'user.bulk.created',
      {
        requestedCount: result.requestedCount,
        createdCount: result.createdCount,
        failedCount: result.failedCount
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function bulkResetTraffic(req, res, next) {
  try {
    const result = await userService.bulkResetTraffic(req.body.userIds);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User traffic reset successfully',
      data: result
    });

    webhookService.emitEvent(
      'user.bulk.traffic.reset',
      {
        updatedCount: result.updatedCount,
        userIds: req.body.userIds || []
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function bulkExtendExpiry(req, res, next) {
  try {
    const result = await userService.bulkExtendExpiry(req.body.userIds, req.body.days);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User expiry extended successfully',
      data: result
    });

    webhookService.emitEvent(
      'user.bulk.expiry.extended',
      {
        updatedCount: result.updatedCount,
        days: req.body.days,
        userIds: req.body.userIds || []
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function bulkUpdateStatus(req, res, next) {
  try {
    const result = await userService.bulkUpdateStatus(req.body.userIds, req.body.status);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User status updated successfully',
      data: result
    });

    webhookService.emitEvent(
      'user.bulk.status.updated',
      {
        updatedCount: result.updatedCount,
        status: req.body.status,
        userIds: req.body.userIds || []
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function bulkAssignInbounds(req, res, next) {
  try {
    const { userIds, inboundIds, mode } = req.body || {};
    const result = await userService.bulkAssignInbounds(userIds, inboundIds, { mode });

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User inbounds assigned successfully',
      data: result
    });

    webhookService.emitEvent(
      'user.bulk.inbounds.assigned',
      {
        updatedCount: result.updatedCount,
        mode: result.mode,
        userIds: result.userIds || [],
        inboundIds: result.inboundIds || []
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function bulkRotateUserKeys(req, res, next) {
  try {
    const { userIds, ...options } = req.body || {};
    const result = await userService.bulkRotateUserKeys(userIds, options);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User keys rotated successfully',
      data: result
    });

    webhookService.emitEvent(
      'user.bulk.keys.rotated',
      {
        updatedCount: result.updatedCount,
        userIds: userIds || []
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function bulkRevokeUserKeys(req, res, next) {
  try {
    const { userIds, ...options } = req.body || {};
    const result = await userService.bulkRevokeUserKeys(userIds, options);

    const response = sendSuccess(res, {
      statusCode: 200,
      message: 'User keys revoked successfully',
      data: result
    });

    webhookService.emitEvent(
      'user.bulk.keys.revoked',
      {
        updatedCount: result.updatedCount,
        userIds: userIds || []
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function bulkReorderUserInboundsByPattern(req, res, next) {
  try {
    const dryRun = Boolean(req.body?.dryRun);
    const result = await userService.bulkReorderUserInboundsByPattern(
      req.body?.userIds || [],
      req.body?.pattern || 'myanmar',
      {
        dryRun
      }
    );

    const response = sendSuccess(res, {
      statusCode: 200,
      message: dryRun
        ? 'Bulk user key reorder dry-run generated successfully'
        : 'Bulk user key order updated successfully',
      data: result
    });

    webhookService.emitEvent(
      dryRun ? 'user.bulk.key.order.pattern.previewed' : 'user.bulk.key.order.pattern.updated',
      {
        userIds: req.body?.userIds || [],
        pattern: result.pattern,
        dryRun,
        summary: result.summary || null
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

async function bulkReorderUserInboundsByQuality(req, res, next) {
  try {
    const dryRun = Boolean(req.body?.dryRun);
    const result = await userService.bulkReorderUserInboundsByQuality(req.body?.userIds || [], {
      windowMinutes: req.body?.windowMinutes,
      dryRun
    });

    const response = sendSuccess(res, {
      statusCode: 200,
      message: dryRun
        ? 'Bulk user key quality reorder dry-run generated successfully'
        : 'Bulk user key order updated successfully',
      data: result
    });

    webhookService.emitEvent(
      dryRun ? 'user.bulk.key.order.quality.previewed' : 'user.bulk.key.order.quality.updated',
      {
        userIds: req.body?.userIds || [],
        windowMinutes: result.windowMinutes,
        dryRun,
        summary: result.summary || null
      },
      {
        actor: buildActorContext(req),
        request: buildRequestContext(req)
      }
    );

    return response;
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listUsers,
  getSessionSnapshots,
  streamSessionSnapshots,
  getUserSessionSnapshot,
  getUser,
  createUser,
  bulkCreate,
  updateUser,
  deleteUser,
  getSubscriptionInfo,
  getUserStats,
  resetTraffic,
  extendExpiry,
  toggleUserInbound,
  updateUserInboundPriority,
  reorderUserInbounds,
  previewUserInboundPatternReorder,
  reorderUserInboundsByPattern,
  getEffectiveInbounds,
  getEffectivePolicy,
  rotateUserKeys,
  revokeUserKeys,
  regenerateSubscriptionToken,
  getUserTraffic,
  getUserDevices,
  revokeUserDevice,
  disconnectUserSessions,
  getUserActivity,
  bulkDelete,
  bulkResetTraffic,
  bulkExtendExpiry,
  bulkUpdateStatus,
  bulkAssignInbounds,
  bulkRotateUserKeys,
  bulkRevokeUserKeys,
  bulkReorderUserInboundsByPattern,
  previewUserInboundQualityReorder,
  reorderUserInboundsByQuality,
  bulkReorderUserInboundsByQuality
};
