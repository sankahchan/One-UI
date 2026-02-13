const os = require('os');

const HTTP_DURATION_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const DB_DURATION_BUCKETS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500];
const MAX_SERIES = 4000;

const state = {
  processStartMs: Date.now(),
  activeRequests: 0,
  onlineUsers: 0,
  httpRequestsTotal: new Map(),
  httpRequestErrorsTotal: new Map(),
  httpRequestDuration: new Map(),
  dbQueriesTotal: new Map(),
  dbQueryErrorsTotal: new Map(),
  dbQueryDuration: new Map(),
  authAttemptsTotal: new Map(),
  authFailuresTotal: new Map(),
  subscriptionRequestsTotal: new Map(),
  subscriptionErrorsTotal: new Map(),
  xrayUpdateRunsTotal: new Map(),
  xrayUpdateLockActive: 0,
  xrayUpdateLockStale: 0,
  xrayUpdateLockAgeSeconds: 0
};

function escapeLabelValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function toLabelKey(labels) {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}:${labels[key]}`)
    .join('|');
}

function toLabelText(labels) {
  const pairs = Object.entries(labels).map(([key, value]) => `${key}="${escapeLabelValue(value)}"`);
  return pairs.length > 0 ? `{${pairs.join(',')}}` : '';
}

function ensureSeries(map, key, create) {
  if (map.has(key)) {
    return map.get(key);
  }

  if (map.size >= MAX_SERIES) {
    return null;
  }

  const value = create();
  map.set(key, value);
  return value;
}

function incrementCounter(map, labels, amount = 1) {
  const key = toLabelKey(labels);
  const entry = ensureSeries(map, key, () => ({ labels, value: 0 }));
  if (!entry) {
    return;
  }

  entry.value += amount;
}

function createHistogramSeries() {
  return {
    count: 0,
    sum: 0,
    bucketCounts: []
  };
}

function observeHistogram(map, buckets, labels, value) {
  const key = toLabelKey(labels);
  const entry = ensureSeries(map, key, () => ({ labels, histogram: createHistogramSeries() }));
  if (!entry) {
    return;
  }

  if (entry.histogram.bucketCounts.length === 0) {
    entry.histogram.bucketCounts = new Array(buckets.length + 1).fill(0);
  }

  const safeValue = Number.isFinite(value) && value >= 0 ? value : 0;
  let bucketIndex = buckets.findIndex((bucket) => safeValue <= bucket);
  if (bucketIndex === -1) {
    bucketIndex = buckets.length;
  }

  entry.histogram.bucketCounts[bucketIndex] += 1;
  entry.histogram.count += 1;
  entry.histogram.sum += safeValue;
}

function normalizeMethod(method) {
  return typeof method === 'string' && method ? method.toUpperCase() : 'GET';
}

function normalizeStatusCode(statusCode) {
  const parsed = Number.parseInt(statusCode, 10);
  if (Number.isNaN(parsed) || parsed < 100 || parsed > 999) {
    return 500;
  }

  return parsed;
}

function normalizePath(pathname) {
  if (!pathname || pathname === '/') {
    return '/';
  }

  const normalized = pathname
    .replace(/\/[a-f0-9]{64}(?=\/|$)/gi, '/:token')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi, '/:uuid')
    .replace(/\/[0-9]+(?=\/|$)/g, '/:id');

  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

function getRouteLabel(req) {
  if (req?.route?.path) {
    const basePath = req.baseUrl || '';
    const routePath = typeof req.route.path === 'string' ? req.route.path : '/';
    return normalizePath(`${basePath}${routePath}`.replace(/\/+/g, '/'));
  }

  const source = req?.originalUrl || req?.url || '/';
  const pathname = source.split('?')[0] || '/';
  return normalizePath(pathname);
}

function classifyStatus(statusCode) {
  if (statusCode >= 500) {
    return '5xx';
  }

  if (statusCode >= 400) {
    return '4xx';
  }

  if (statusCode >= 300) {
    return '3xx';
  }

  if (statusCode >= 200) {
    return '2xx';
  }

  return '1xx';
}

function normalizeLabel(value, fallback = 'unknown', maxLength = 48) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!raw) {
    return fallback;
  }
  if (raw.length > maxLength) {
    return raw.slice(0, maxLength);
  }
  return raw;
}

function classifyAuthFailureReason(reason) {
  const text = String(reason || '').toLowerCase();
  if (!text) {
    return 'unknown';
  }
  if (text.includes('invalid credential')) {
    return 'invalid_credentials';
  }
  if (text.includes('otp') && text.includes('required')) {
    return 'otp_required';
  }
  if (text.includes('otp') || text.includes('two-factor') || text.includes('2fa')) {
    return 'otp_invalid';
  }
  if (text.includes('locked') || text.includes('lockout')) {
    return 'account_locked';
  }
  if (text.includes('ip is not allowed') || text.includes('ip not allowed') || text.includes('ip blocked')) {
    return 'ip_restricted';
  }
  if (text.includes('rate limit') || text.includes('too many')) {
    return 'rate_limited';
  }
  if (text.includes('token') && (text.includes('invalid') || text.includes('expired'))) {
    return 'token_invalid';
  }
  if (text.includes('disabled') || text.includes('inactive')) {
    return 'account_disabled';
  }
  return 'other';
}

function parseDbOperation(query) {
  if (typeof query !== 'string' || !query.trim()) {
    return 'UNKNOWN';
  }

  const keyword = query.trim().split(/\s+/)[0].toUpperCase();
  return keyword.replace(/[^A-Z_]/g, '') || 'UNKNOWN';
}

function recordHttpRequest({ method, route, statusCode, durationMs }) {
  const normalizedMethod = normalizeMethod(method);
  const normalizedRoute = normalizePath(route || '/');
  const normalizedStatusCode = normalizeStatusCode(statusCode);
  const statusClass = classifyStatus(normalizedStatusCode);

  incrementCounter(state.httpRequestsTotal, {
    method: normalizedMethod,
    route: normalizedRoute,
    status: String(normalizedStatusCode)
  });

  if (normalizedStatusCode >= 400) {
    incrementCounter(state.httpRequestErrorsTotal, {
      method: normalizedMethod,
      route: normalizedRoute,
      status_class: statusClass
    });
  }

  observeHistogram(
    state.httpRequestDuration,
    HTTP_DURATION_BUCKETS,
    {
      method: normalizedMethod,
      route: normalizedRoute
    },
    durationMs
  );
}

function recordDbQuery(durationMs, query) {
  const operation = parseDbOperation(query);
  incrementCounter(state.dbQueriesTotal, { operation });

  observeHistogram(
    state.dbQueryDuration,
    DB_DURATION_BUCKETS,
    {
      operation
    },
    Number(durationMs)
  );
}

function recordDbQueryError(target) {
  incrementCounter(state.dbQueryErrorsTotal, {
    target: target || 'unknown'
  });
}

function recordAuthAttempt({ method, success, reason } = {}) {
  const methodLabel = normalizeLabel(method || 'password', 'password');
  const outcome = success ? 'success' : 'failure';

  incrementCounter(state.authAttemptsTotal, {
    method: methodLabel,
    outcome
  });

  if (!success) {
    incrementCounter(state.authFailuresTotal, {
      method: methodLabel,
      reason: normalizeLabel(classifyAuthFailureReason(reason), 'unknown')
    });
  }
}

function recordSubscriptionRequest({ format, statusCode } = {}) {
  const normalizedStatusCode = normalizeStatusCode(statusCode);
  const statusClass = classifyStatus(normalizedStatusCode);
  const formatLabel = normalizeLabel(format || 'v2ray', 'unknown');

  incrementCounter(state.subscriptionRequestsTotal, {
    format: formatLabel,
    status_class: statusClass
  });

  if (normalizedStatusCode >= 400) {
    incrementCounter(state.subscriptionErrorsTotal, {
      format: formatLabel,
      status_class: statusClass
    });
  }
}

function recordXrayUpdateRun({ stage, status } = {}) {
  incrementCounter(state.xrayUpdateRunsTotal, {
    stage: normalizeLabel(stage || 'unknown', 'unknown'),
    status: normalizeLabel(status || 'unknown', 'unknown')
  });
}

function setXrayUpdateLockState({ active, stale, ageSeconds } = {}) {
  const activeValue = Number(active);
  const staleValue = Number(stale);
  const ageValue = Number(ageSeconds);

  state.xrayUpdateLockActive = activeValue > 0 ? 1 : 0;
  state.xrayUpdateLockStale = staleValue > 0 ? 1 : 0;
  state.xrayUpdateLockAgeSeconds = Number.isFinite(ageValue) && ageValue >= 0
    ? ageValue
    : 0;
}

function setOnlineUsers(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return;
  }

  state.onlineUsers = parsed;
}

function pushMetricHeader(lines, name, type, help) {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} ${type}`);
}

function appendCounterMap(lines, name, map) {
  for (const entry of map.values()) {
    lines.push(`${name}${toLabelText(entry.labels)} ${entry.value}`);
  }
}

function appendHistogramMap(lines, name, buckets, map) {
  for (const entry of map.values()) {
    const labels = entry.labels;
    const bucketCounts = entry.histogram.bucketCounts;

    let cumulative = 0;
    for (let i = 0; i < buckets.length; i += 1) {
      cumulative += bucketCounts[i] || 0;
      lines.push(`${name}_bucket${toLabelText({ ...labels, le: String(buckets[i]) })} ${cumulative}`);
    }

    cumulative += bucketCounts[buckets.length] || 0;
    lines.push(`${name}_bucket${toLabelText({ ...labels, le: '+Inf' })} ${cumulative}`);
    lines.push(`${name}_sum${toLabelText(labels)} ${entry.histogram.sum.toFixed(6)}`);
    lines.push(`${name}_count${toLabelText(labels)} ${entry.histogram.count}`);
  }
}

function renderPrometheusMetrics() {
  const lines = [];
  const processUptimeSeconds = (Date.now() - state.processStartMs) / 1000;
  const mem = process.memoryUsage();

  pushMetricHeader(lines, 'oneui_http_requests_active', 'gauge', 'Current active HTTP requests.');
  lines.push(`oneui_http_requests_active ${state.activeRequests}`);

  pushMetricHeader(lines, 'oneui_http_requests_total', 'counter', 'Total HTTP requests by method, route, and status code.');
  appendCounterMap(lines, 'oneui_http_requests_total', state.httpRequestsTotal);

  pushMetricHeader(lines, 'oneui_http_request_errors_total', 'counter', 'Total HTTP error responses grouped by status class.');
  appendCounterMap(lines, 'oneui_http_request_errors_total', state.httpRequestErrorsTotal);

  pushMetricHeader(lines, 'oneui_http_request_duration_ms', 'histogram', 'HTTP request duration in milliseconds.');
  appendHistogramMap(lines, 'oneui_http_request_duration_ms', HTTP_DURATION_BUCKETS, state.httpRequestDuration);

  pushMetricHeader(lines, 'oneui_db_queries_total', 'counter', 'Total database queries grouped by operation type.');
  appendCounterMap(lines, 'oneui_db_queries_total', state.dbQueriesTotal);

  pushMetricHeader(lines, 'oneui_db_query_errors_total', 'counter', 'Total database query errors grouped by target.');
  appendCounterMap(lines, 'oneui_db_query_errors_total', state.dbQueryErrorsTotal);

  pushMetricHeader(lines, 'oneui_db_query_duration_ms', 'histogram', 'Database query duration in milliseconds.');
  appendHistogramMap(lines, 'oneui_db_query_duration_ms', DB_DURATION_BUCKETS, state.dbQueryDuration);

  pushMetricHeader(lines, 'oneui_online_users', 'gauge', 'Current online users reported by in-memory collectors.');
  lines.push(`oneui_online_users ${state.onlineUsers}`);

  pushMetricHeader(lines, 'oneui_auth_attempts_total', 'counter', 'Total auth attempts grouped by auth method and outcome.');
  appendCounterMap(lines, 'oneui_auth_attempts_total', state.authAttemptsTotal);

  pushMetricHeader(lines, 'oneui_auth_failures_total', 'counter', 'Total auth failures grouped by auth method and failure reason.');
  appendCounterMap(lines, 'oneui_auth_failures_total', state.authFailuresTotal);

  pushMetricHeader(lines, 'oneui_subscription_requests_total', 'counter', 'Total subscription endpoint requests grouped by format and status class.');
  appendCounterMap(lines, 'oneui_subscription_requests_total', state.subscriptionRequestsTotal);

  pushMetricHeader(lines, 'oneui_subscription_errors_total', 'counter', 'Total subscription endpoint errors grouped by format and status class.');
  appendCounterMap(lines, 'oneui_subscription_errors_total', state.subscriptionErrorsTotal);

  pushMetricHeader(lines, 'oneui_xray_update_runs_total', 'counter', 'Total Xray update runs grouped by stage and result status.');
  appendCounterMap(lines, 'oneui_xray_update_runs_total', state.xrayUpdateRunsTotal);

  pushMetricHeader(lines, 'oneui_xray_update_lock_active', 'gauge', 'Whether Xray update lock is currently active (1 or 0).');
  lines.push(`oneui_xray_update_lock_active ${state.xrayUpdateLockActive}`);

  pushMetricHeader(lines, 'oneui_xray_update_lock_stale', 'gauge', 'Whether Xray update lock is stale (1 or 0).');
  lines.push(`oneui_xray_update_lock_stale ${state.xrayUpdateLockStale}`);

  pushMetricHeader(lines, 'oneui_xray_update_lock_age_seconds', 'gauge', 'Current Xray update lock age in seconds.');
  lines.push(`oneui_xray_update_lock_age_seconds ${state.xrayUpdateLockAgeSeconds.toFixed(3)}`);

  pushMetricHeader(lines, 'oneui_process_uptime_seconds', 'gauge', 'Node.js process uptime in seconds.');
  lines.push(`oneui_process_uptime_seconds ${processUptimeSeconds.toFixed(3)}`);

  pushMetricHeader(lines, 'oneui_process_resident_memory_bytes', 'gauge', 'Resident memory usage in bytes.');
  lines.push(`oneui_process_resident_memory_bytes ${mem.rss}`);

  pushMetricHeader(lines, 'oneui_process_heap_used_bytes', 'gauge', 'Node.js heap used in bytes.');
  lines.push(`oneui_process_heap_used_bytes ${mem.heapUsed}`);

  pushMetricHeader(lines, 'oneui_process_heap_total_bytes', 'gauge', 'Node.js heap total in bytes.');
  lines.push(`oneui_process_heap_total_bytes ${mem.heapTotal}`);

  pushMetricHeader(lines, 'oneui_system_load_average_1m', 'gauge', 'OS load average over 1 minute.');
  lines.push(`oneui_system_load_average_1m ${os.loadavg()[0].toFixed(3)}`);

  return `${lines.join('\n')}\n`;
}

function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  state.activeRequests += 1;

  let done = false;
  const finalize = (statusCode) => {
    if (done) {
      return;
    }

    done = true;
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;

    recordHttpRequest({
      method: req.method,
      route: getRouteLabel(req),
      statusCode,
      durationMs
    });

    state.activeRequests = Math.max(0, state.activeRequests - 1);
  };

  res.on('finish', () => finalize(res.statusCode));
  res.on('close', () => {
    if (!res.writableEnded) {
      finalize(499);
    }
  });

  next();
}

module.exports = {
  metricsMiddleware,
  getRouteLabel,
  recordDbQuery,
  recordDbQueryError,
  recordAuthAttempt,
  recordSubscriptionRequest,
  recordXrayUpdateRun,
  setXrayUpdateLockState,
  setOnlineUsers,
  renderPrometheusMetrics,
  CONTENT_TYPE: 'text/plain; version=0.0.4; charset=utf-8'
};
