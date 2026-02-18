/**
 * Debounced Xray config reload queue.
 *
 * When inbounds, users, or groups are created/updated/deleted the Xray
 * process needs to be told about the change.  Rather than reloading
 * synchronously inside every controller (which would slow down API
 * responses and cause redundant reloads during bulk operations), we
 * queue a single debounced reload that fires shortly after the last
 * mutation.
 *
 * Usage:
 *   const { scheduleXrayReload } = require('../utils/xrayReloadQueue');
 *   scheduleXrayReload();          // queues a reload 1.5 s from now
 *   scheduleXrayReload('user.created');  // optional reason for logging
 */

const RELOAD_DELAY_MS = 1500; // debounce window

let _timer = null;
let _pendingReasons = [];
let _reloading = false;

function getLogger() {
  try {
    return require('../config/logger');
  } catch (_error) {
    return console;
  }
}

function getXrayManager() {
  // Lazy-require to avoid circular dependency issues at startup
  return require('../xray/manager');
}

async function _doReload(reasons) {
  const logger = getLogger();
  try {
    _reloading = true;
    const xrayManager = getXrayManager();
    const result = await xrayManager.reloadConfig();
    logger.info({
      action: 'xray_auto_reload',
      success: true,
      reasons,
      inbounds: result?.inbounds ?? null
    });
  } catch (error) {
    logger.error({
      action: 'xray_auto_reload',
      success: false,
      reasons,
      error: error.message
    });
  } finally {
    _reloading = false;
  }
}

/**
 * Schedule (or re-schedule) an Xray config reload.
 * Multiple calls within the debounce window collapse into one reload.
 *
 * @param {string} [reason] - optional label for logging (e.g. 'inbound.created')
 */
function scheduleXrayReload(reason) {
  if (reason) {
    _pendingReasons.push(reason);
  }

  if (_timer) {
    clearTimeout(_timer);
  }

  _timer = setTimeout(() => {
    _timer = null;
    const reasons = _pendingReasons.splice(0);
    _doReload(reasons);
  }, RELOAD_DELAY_MS);
}

/** True while a reload is in flight. */
function isReloading() {
  return _reloading;
}

/** Cancel any pending scheduled reload (useful in tests). */
function cancelPendingReload() {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
  _pendingReasons = [];
}

module.exports = {
  scheduleXrayReload,
  isReloading,
  cancelPendingReload
};
