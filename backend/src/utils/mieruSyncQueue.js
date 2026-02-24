/**
 * Debounced Mieru user/config sync queue.
 *
 * Any user/inbound/group mutation can trigger this queue indirectly via the
 * Xray reload queue hook, so One-UI updates are collapsed into a single sync
 * operation instead of restarting Mieru on every API call.
 */

const DEFAULT_SYNC_DELAY_MS = Number.parseInt(String(process.env.MIERU_SYNC_DEBOUNCE_MS || '1500'), 10);
const SYNC_DELAY_MS = Number.isInteger(DEFAULT_SYNC_DELAY_MS) && DEFAULT_SYNC_DELAY_MS >= 100
  ? DEFAULT_SYNC_DELAY_MS
  : 1500;

let _timer = null;
let _pendingReasons = [];
let _syncing = false;

function getLogger() {
  try {
    return require('../config/logger');
  } catch (_error) {
    return console;
  }
}

function getMieruSyncService() {
  return require('../services/mieruSync.service');
}

async function _doSync(reasons) {
  const logger = getLogger();

  try {
    _syncing = true;
    const service = getMieruSyncService();
    const result = await service.syncUsers({
      reason: reasons.join(',') || 'queue'
    });

    const logPayload = {
      action: 'mieru_auto_sync',
      success: true,
      reasons,
      skipped: result.skipped,
      skippedReason: result.skippedReason || null,
      changed: result.changed,
      userCount: result.userCount,
      restarted: result.restarted,
      restartError: result.restartError || null
    };

    if (result.skipped) {
      logger.debug?.(logPayload);
    } else {
      logger.info(logPayload);
    }
  } catch (error) {
    logger.error({
      action: 'mieru_auto_sync',
      success: false,
      reasons,
      error: error.message
    });
  } finally {
    _syncing = false;
  }
}

function scheduleMieruSync(reason) {
  if (reason) {
    _pendingReasons.push(reason);
  }

  if (_timer) {
    clearTimeout(_timer);
  }

  _timer = setTimeout(() => {
    _timer = null;
    const reasons = _pendingReasons.splice(0);
    void _doSync(reasons);
  }, SYNC_DELAY_MS);

  if (_timer && typeof _timer.unref === 'function') {
    _timer.unref();
  }
}

function isSyncing() {
  return _syncing;
}

function cancelPendingSync() {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
  _pendingReasons = [];
}

module.exports = {
  scheduleMieruSync,
  isSyncing,
  cancelPendingSync
};
