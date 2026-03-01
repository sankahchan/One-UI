const prisma = require('../config/database');
const env = require('../config/env');
const logger = require('../config/logger');
const net = require('node:net');
const tls = require('node:tls');
const cryptoService = require('./crypto.service');
const xrayManager = require('../xray/manager');
const xrayStatsCollector = require('../xray/stats-collector');
const onlineTracker = require('../xray/online-tracker');
const ipTrackingService = require('./ipTracking.service');
const deviceTrackingService = require('./deviceTracking.service');
const connectionLogsService = require('./connectionLogs.service');
const cloudflareService = require('./cloudflare.service');
const { scheduleMieruSync } = require('../utils/mieruSyncQueue');
const { shortFingerprint } = require('../utils/deviceFingerprint');
const { normalizeClientIp } = require('../utils/network');
const { NotFoundError, ValidationError } = require('../utils/errors');

const BYTES_PER_GB = 1024 * 1024 * 1024;

function parseId(id) {
  const parsedId = Number.parseInt(id, 10);

  if (Number.isNaN(parsedId) || parsedId < 1) {
    throw new ValidationError('id must be a positive integer');
  }

  return parsedId;
}

function normalizePositiveIdArray(values, fieldName = 'ids') {
  if (!Array.isArray(values) || values.length === 0) {
    throw new ValidationError(`${fieldName} must be a non-empty array`);
  }

  const parsed = values
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (parsed.length === 0) {
    throw new ValidationError(`${fieldName} must contain positive integer IDs`);
  }

  return Array.from(new Set(parsed));
}

function parsePositiveNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (Number.isNaN(parsed) || parsed < 0) {
    throw new ValidationError('numeric value must be a non-negative number');
  }

  return parsed;
}

function parseBoundedInt(value, { min, max, fallback }) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  if (typeof min === 'number' && parsed < min) {
    return min;
  }

  if (typeof max === 'number' && parsed > max) {
    return max;
  }

  return parsed;
}

function parseBoundedFloat(value, { min, max, fallback }) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseFloat(String(value));
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  if (typeof min === 'number' && parsed < min) {
    return min;
  }

  if (typeof max === 'number' && parsed > max) {
    return max;
  }

  return parsed;
}

function parseNonNegativeBigInt(value, fallback = 0n) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'bigint') {
    return value >= 0n ? value : fallback;
  }

  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    return fallback;
  }

  try {
    return BigInt(normalized);
  } catch (_error) {
    return fallback;
  }
}

function parseBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return fallback;
    }

    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
      return true;
    }

    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function gbToBytes(value) {
  const gb = parsePositiveNumber(value, 0);
  return BigInt(Math.floor(gb * BYTES_PER_GB));
}

function normalizePriority(value, fallback = 100) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(parsed, 9999));
}

function normalizeInboundAssignments(inboundInput) {
  if (!Array.isArray(inboundInput)) {
    return [];
  }

  const normalized = [];
  const seenInboundIds = new Set();

  inboundInput.forEach((entry, index) => {
    if (entry === null || entry === undefined) {
      return;
    }

    if (typeof entry === 'number' || typeof entry === 'string') {
      const inboundId = Number.parseInt(entry, 10);
      if (!Number.isInteger(inboundId) || inboundId < 1 || seenInboundIds.has(inboundId)) {
        return;
      }

      seenInboundIds.add(inboundId);
      normalized.push({
        inboundId,
        enabled: true,
        priority: normalizePriority(100 + index)
      });
      return;
    }

    if (typeof entry === 'object') {
      const inboundId = Number.parseInt(
        String(entry.inboundId ?? entry.id ?? entry.value ?? ''),
        10
      );
      if (!Number.isInteger(inboundId) || inboundId < 1 || seenInboundIds.has(inboundId)) {
        return;
      }

      seenInboundIds.add(inboundId);
      normalized.push({
        inboundId,
        enabled: entry.enabled === undefined ? true : Boolean(entry.enabled),
        priority: normalizePriority(entry.priority, 100 + index)
      });
    }
  });

  return normalized;
}

function resolveMyanmarInboundBucket(inbound) {
  const protocol = String(inbound?.protocol || '').toUpperCase();
  const network = String(inbound?.network || '').toUpperCase();
  const security = String(inbound?.security || '').toUpperCase();

  if (protocol === 'VLESS' && security === 'REALITY') {
    return 0;
  }

  if (protocol === 'VLESS' && network === 'WS' && security === 'TLS') {
    return 1;
  }

  if (protocol === 'TROJAN' && network === 'WS' && security === 'TLS') {
    return 2;
  }

  if (protocol === 'VLESS' && network === 'GRPC' && security === 'TLS') {
    return 3;
  }

  return 99;
}

function sortMyanmarPreferredInbounds(inbounds = []) {
  return [...inbounds].sort((a, b) => {
    const aBucket = resolveMyanmarInboundBucket(a);
    const bBucket = resolveMyanmarInboundBucket(b);
    if (aBucket !== bBucket) {
      return aBucket - bBucket;
    }

    const aCreatedAt = a?.createdAt instanceof Date ? a.createdAt.getTime() : 0;
    const bCreatedAt = b?.createdAt instanceof Date ? b.createdAt.getTime() : 0;
    if (aCreatedAt !== bCreatedAt) {
      return aCreatedAt - bCreatedAt;
    }

    return Number(a?.id || 0) - Number(b?.id || 0);
  });
}

async function buildMyanmarDefaultInboundAssignments() {
  const enabledInbounds = await prisma.inbound.findMany({
    where: { enabled: true },
    select: {
      id: true,
      protocol: true,
      network: true,
      security: true,
      createdAt: true
    }
  });

  if (enabledInbounds.length === 0) {
    return [];
  }

  const preferred = sortMyanmarPreferredInbounds(enabledInbounds);
  const selected = preferred.slice(0, 3);

  return selected.map((inbound, index) => ({
    inboundId: inbound.id,
    enabled: true,
    priority: normalizePriority(100 + index)
  }));
}

async function validateEnabledInboundAssignments(
  inboundInput,
  {
    requireAtLeastOne = true,
    allowAutoMyanmarDefaults = false
  } = {}
) {
  let inboundAssignments = normalizeInboundAssignments(inboundInput);

  if (inboundAssignments.length === 0 && allowAutoMyanmarDefaults && parseBooleanFlag(env.MYANMAR_DEFAULTS_ENABLED, true)) {
    inboundAssignments = await buildMyanmarDefaultInboundAssignments();
  }

  if (inboundAssignments.length === 0) {
    if (requireAtLeastOne) {
      throw new ValidationError('at least one enabled inbound is required');
    }
    return [];
  }

  if (requireAtLeastOne && !inboundAssignments.some((assignment) => assignment.enabled)) {
    throw new ValidationError('at least one enabled inbound is required');
  }

  const inboundIds = inboundAssignments.map((assignment) => assignment.inboundId);
  const enabledInbounds = await prisma.inbound.findMany({
    where: {
      id: { in: inboundIds },
      enabled: true
    },
    select: { id: true }
  });

  const enabledInboundIdSet = new Set(enabledInbounds.map((inbound) => inbound.id));
  const invalidOrDisabled = inboundIds.filter((inboundId) => !enabledInboundIdSet.has(inboundId));
  if (invalidOrDisabled.length > 0) {
    throw new ValidationError(
      `inboundIds contain invalid or disabled entries: ${Array.from(new Set(invalidOrDisabled)).join(', ')}`
    );
  }

  return inboundAssignments;
}

const USER_INBOUND_PATTERN_MYANMAR = 'myanmar';
const SUPPORTED_USER_INBOUND_PATTERNS = new Set([USER_INBOUND_PATTERN_MYANMAR]);

function normalizeInboundPattern(pattern = USER_INBOUND_PATTERN_MYANMAR) {
  const normalized = String(pattern || USER_INBOUND_PATTERN_MYANMAR).trim().toLowerCase();
  if (!SUPPORTED_USER_INBOUND_PATTERNS.has(normalized)) {
    throw new ValidationError(`pattern must be one of: ${Array.from(SUPPORTED_USER_INBOUND_PATTERNS).join(', ')}`);
  }
  return normalized;
}

function resolvePatternBucketForRelation(relation, pattern) {
  if (pattern !== USER_INBOUND_PATTERN_MYANMAR) {
    return 99;
  }

  const protocol = String(relation?.inbound?.protocol || '').toUpperCase();
  const network = String(relation?.inbound?.network || '').toUpperCase();
  const security = String(relation?.inbound?.security || '').toUpperCase();

  if (protocol === 'VLESS' && security === 'REALITY') {
    return 0;
  }

  if (protocol === 'VLESS' && network === 'WS' && security === 'TLS') {
    return 1;
  }

  if (protocol === 'TROJAN' && network === 'WS' && security === 'TLS') {
    return 2;
  }

  return 99;
}

function buildInboundPreviewLabel(relation, fallbackIndex = 0) {
  const tag = String(relation?.inbound?.tag || '').trim();
  if (tag) {
    return tag;
  }

  const remark = String(relation?.inbound?.remark || '').trim();
  if (remark) {
    return remark;
  }

  const protocol = String(relation?.inbound?.protocol || 'INBOUND').toUpperCase();
  const port = Number.parseInt(String(relation?.inbound?.port ?? ''), 10);
  if (Number.isInteger(port) && port > 0) {
    return `${protocol}:${port}`;
  }

  const inboundId = Number.parseInt(String(relation?.inboundId ?? ''), 10);
  if (Number.isInteger(inboundId) && inboundId > 0) {
    return `inbound-${inboundId}`;
  }

  return `key-${fallbackIndex + 1}`;
}

function toPatternPreviewEntry(entry, nextPriority) {
  return {
    inboundId: entry.inboundId,
    key: entry.label,
    protocol: entry.protocol,
    network: entry.network,
    security: entry.security,
    fromPriority: entry.currentPriority,
    toPriority: nextPriority,
    matched: entry.bucket < 99
  };
}

function buildPatternReorderPlan(relations, pattern) {
  const source = Array.isArray(relations)
    ? relations.filter(
      (relation) => Number.isInteger(Number(relation?.inboundId)) && Number(relation.inboundId) > 0
    )
    : [];

  const ranked = source.map((relation, index) => {
    const inboundId = Number.parseInt(String(relation.inboundId), 10);
    const currentPriority = normalizePriority(relation.priority, 100 + index);
    const bucket = resolvePatternBucketForRelation(relation, pattern);

    return {
      relation,
      index,
      inboundId,
      enabled: Boolean(relation.enabled),
      currentPriority,
      bucket,
      label: buildInboundPreviewLabel(relation, index),
      protocol: String(relation?.inbound?.protocol || '').toUpperCase(),
      network: String(relation?.inbound?.network || '').toUpperCase(),
      security: String(relation?.inbound?.security || '').toUpperCase()
    };
  });

  const currentOrdered = [...ranked].sort((a, b) => {
    if (a.currentPriority !== b.currentPriority) {
      return a.currentPriority - b.currentPriority;
    }
    return a.index - b.index;
  });

  const reordered = [...ranked].sort((a, b) => {
    if (a.bucket !== b.bucket) {
      return a.bucket - b.bucket;
    }
    if (a.currentPriority !== b.currentPriority) {
      return a.currentPriority - b.currentPriority;
    }
    return a.index - b.index;
  });

  const assignments = reordered.map((entry, index) => ({
    inboundId: entry.inboundId,
    priority: normalizePriority(100 + index),
    enabled: entry.enabled
  }));

  const currentByInboundId = new Map(ranked.map((entry) => [entry.inboundId, entry]));
  const nextPriorityByInboundId = new Map(assignments.map((entry) => [entry.inboundId, entry.priority]));

  const changedKeys = assignments.reduce((count, assignment) => {
    const current = currentByInboundId.get(assignment.inboundId);
    if (!current) {
      return count;
    }
    return current.currentPriority === assignment.priority ? count : count + 1;
  }, 0);

  return {
    totalKeys: ranked.length,
    matchedKeys: ranked.filter((entry) => entry.bucket < 99).length,
    changedKeys,
    assignments,
    currentTop3: currentOrdered
      .slice(0, 3)
      .map((entry) => toPatternPreviewEntry(entry, entry.currentPriority)),
    newTop3: reordered
      .slice(0, 3)
      .map((entry) => toPatternPreviewEntry(entry, nextPriorityByInboundId.get(entry.inboundId) || entry.currentPriority)),
    preview: reordered.map((entry) =>
      toPatternPreviewEntry(entry, nextPriorityByInboundId.get(entry.inboundId) || entry.currentPriority)
    )
  };
}

function toQualityPreviewEntry(entry, nextPriority) {
  return {
    inboundId: entry.inboundId,
    key: entry.label,
    protocol: entry.protocol,
    network: entry.network,
    security: entry.security,
    fromPriority: entry.currentPriority,
    toPriority: nextPriority,
    telemetry: entry.hasTelemetry,
    score: entry.score,
    connectSuccesses: entry.connectSuccesses,
    limitRejects: entry.limitRejects,
    reconnects: entry.reconnects
  };
}

function buildQualityReorderPlan(relations, byProfile = []) {
  const source = Array.isArray(relations)
    ? relations.filter(
      (relation) => Number.isInteger(Number(relation?.inboundId)) && Number(relation.inboundId) > 0
    )
    : [];

  const telemetryByInboundId = new Map();
  if (Array.isArray(byProfile)) {
    for (const entry of byProfile) {
      const inboundId = Number.parseInt(String(entry?.inboundId ?? ''), 10);
      if (!Number.isInteger(inboundId) || inboundId < 1) {
        continue;
      }
      telemetryByInboundId.set(inboundId, {
        score: Number(entry?.score ?? 0),
        connectSuccesses: Number(entry?.connectSuccesses ?? 0),
        limitRejects: Number(entry?.limitRejects ?? 0),
        reconnects: Number(entry?.reconnects ?? 0)
      });
    }
  }

  const ranked = source.map((relation, index) => {
    const inboundId = Number.parseInt(String(relation.inboundId), 10);
    const currentPriority = normalizePriority(relation.priority, 100 + index);
    const telemetry = telemetryByInboundId.get(inboundId) || null;

    return {
      relation,
      index,
      inboundId,
      enabled: Boolean(relation.enabled),
      currentPriority,
      label: buildInboundPreviewLabel(relation, index),
      protocol: String(relation?.inbound?.protocol || '').toUpperCase(),
      network: String(relation?.inbound?.network || '').toUpperCase(),
      security: String(relation?.inbound?.security || '').toUpperCase(),
      hasTelemetry: Boolean(telemetry),
      score: telemetry ? Number(telemetry.score) : null,
      connectSuccesses: telemetry ? Number(telemetry.connectSuccesses) : 0,
      limitRejects: telemetry ? Number(telemetry.limitRejects) : 0,
      reconnects: telemetry ? Number(telemetry.reconnects) : 0
    };
  });

  const currentOrdered = [...ranked].sort((a, b) => {
    if (a.currentPriority !== b.currentPriority) {
      return a.currentPriority - b.currentPriority;
    }
    return a.index - b.index;
  });

  const reordered = [...ranked].sort((a, b) => {
    if (a.hasTelemetry !== b.hasTelemetry) {
      return a.hasTelemetry ? -1 : 1;
    }
    if (a.hasTelemetry && b.hasTelemetry) {
      const scoreA = a.score ?? 0;
      const scoreB = b.score ?? 0;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      if (a.connectSuccesses !== b.connectSuccesses) {
        return b.connectSuccesses - a.connectSuccesses;
      }
      if (a.limitRejects !== b.limitRejects) {
        return a.limitRejects - b.limitRejects;
      }
      if (a.reconnects !== b.reconnects) {
        return a.reconnects - b.reconnects;
      }
    }

    if (a.currentPriority !== b.currentPriority) {
      return a.currentPriority - b.currentPriority;
    }
    return a.index - b.index;
  });

  const assignments = reordered.map((entry, index) => ({
    inboundId: entry.inboundId,
    priority: normalizePriority(100 + index),
    enabled: entry.enabled
  }));

  const currentByInboundId = new Map(ranked.map((entry) => [entry.inboundId, entry]));
  const nextPriorityByInboundId = new Map(assignments.map((entry) => [entry.inboundId, entry.priority]));

  const changedKeys = assignments.reduce((count, assignment) => {
    const current = currentByInboundId.get(assignment.inboundId);
    if (!current) {
      return count;
    }
    return current.currentPriority === assignment.priority ? count : count + 1;
  }, 0);

  return {
    totalKeys: ranked.length,
    scoredKeys: ranked.filter((entry) => entry.hasTelemetry).length,
    changedKeys,
    assignments,
    currentTop3: currentOrdered
      .slice(0, 3)
      .map((entry) => toQualityPreviewEntry(entry, entry.currentPriority)),
    newTop3: reordered
      .slice(0, 3)
      .map((entry) => toQualityPreviewEntry(entry, nextPriorityByInboundId.get(entry.inboundId) || entry.currentPriority)),
    preview: reordered.map((entry) =>
      toQualityPreviewEntry(entry, nextPriorityByInboundId.get(entry.inboundId) || entry.currentPriority)
    )
  };
}

function normalizeBulkDomain(domain) {
  return String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
}

function buildBulkEmail(prefix, domain, index, padding) {
  const safePrefix = String(prefix || '').trim();
  const safeDomain = normalizeBulkDomain(domain);
  const indexValue = Number(index);
  const numericSuffix = Number.isInteger(indexValue) ? indexValue : 1;
  const safePadding = Number.isInteger(Number(padding)) ? Math.max(0, Number(padding)) : 0;
  const suffix = safePadding > 0 ? String(numericSuffix).padStart(safePadding, '0') : String(numericSuffix);
  return `${safePrefix}${suffix}@${safeDomain}`;
}

async function reloadXrayIfEnabled(operation) {
  scheduleMieruSync(operation ? `user.${operation}` : 'user.mutation');

  if (!env.XRAY_AUTO_RELOAD) {
    return;
  }

  try {
    await xrayManager.restart();
  } catch (error) {
    logger.warn('Xray auto-reload failed; continuing request', {
      operation,
      message: error.message
    });

    if (env.XRAY_AUTO_RELOAD_STRICT) {
      throw error;
    }
  }
}

function normalizeDestHostPort(value, fallbackPort = 443) {
  const raw = String(value || '').trim();
  if (!raw) {
    return { host: '', port: fallbackPort };
  }

  const segments = raw.split(':');
  if (segments.length === 1) {
    return { host: segments[0], port: fallbackPort };
  }

  const portCandidate = Number.parseInt(segments.pop() || '', 10);
  const host = segments.join(':');
  return {
    host,
    port: Number.isInteger(portCandidate) && portCandidate > 0 ? portCandidate : fallbackPort
  };
}

function normalizeEndpointHost(hostname = '') {
  const value = String(hostname || '').trim();
  if (!value) {
    return '';
  }

  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function isValidEndpointHost(hostname = '') {
  const value = normalizeEndpointHost(hostname);
  if (!value || value.length > 253) {
    return false;
  }

  if (net.isIP(value)) {
    return true;
  }

  if (!/^[a-zA-Z0-9.-]+$/.test(value)) {
    return false;
  }

  if (value.startsWith('.') || value.endsWith('.') || value.includes('..')) {
    return false;
  }

  return value
    .split('.')
    .every((label) => /^[a-zA-Z0-9-]{1,63}$/.test(label) && !label.startsWith('-') && !label.endsWith('-'));
}

function parseEndpointHostPort(value, fallbackPort = 0) {
  const raw = String(value || '').trim();
  if (!raw) {
    return { host: '', port: fallbackPort };
  }

  const bracketedIpv6 = raw.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketedIpv6) {
    const host = normalizeEndpointHost(bracketedIpv6[1]);
    const port = Number.parseInt(bracketedIpv6[2] || '', 10);
    return {
      host,
      port: Number.isInteger(port) && port > 0 ? port : fallbackPort
    };
  }

  const separator = raw.lastIndexOf(':');
  if (separator > 0 && separator < raw.length - 1) {
    const hostCandidate = raw.slice(0, separator).trim();
    const portCandidate = Number.parseInt(raw.slice(separator + 1).trim(), 10);
    if (hostCandidate && Number.isInteger(portCandidate) && portCandidate > 0) {
      return {
        host: normalizeEndpointHost(hostCandidate),
        port: portCandidate
      };
    }
  }

  return {
    host: normalizeEndpointHost(raw),
    port: fallbackPort
  };
}

function resolveInboundEndpoint(inbound) {
  const protocol = String(inbound?.protocol || '').toUpperCase();
  const fallbackPort = Number.parseInt(String(inbound?.port || ''), 10);

  if (protocol === 'WIREGUARD') {
    const endpoint = String(inbound?.wgPeerEndpoint || '').trim();
    if (!endpoint) {
      return {
        host: normalizeEndpointHost(inbound?.serverAddress),
        port: Number.isInteger(fallbackPort) && fallbackPort > 0 ? fallbackPort : 51820
      };
    }
    return parseEndpointHostPort(endpoint, Number.isInteger(fallbackPort) && fallbackPort > 0 ? fallbackPort : 51820);
  }

  if (protocol === 'DOKODEMO_DOOR') {
    return {
      host: resolvePublicProbeHost() || normalizeEndpointHost(inbound?.serverAddress),
      port: Number.isInteger(fallbackPort) && fallbackPort > 0 ? fallbackPort : 0
    };
  }

  return {
    host: normalizeEndpointHost(inbound?.serverAddress),
    port: Number.isInteger(fallbackPort) && fallbackPort > 0 ? fallbackPort : 0
  };
}

function shouldProbeInboundTcpEndpoint(inbound) {
  const protocol = String(inbound?.protocol || '').toUpperCase();
  if (protocol === 'WIREGUARD') {
    return false;
  }

  if (protocol === 'DOKODEMO_DOOR') {
    const dokodemoNetwork = String(inbound?.dokodemoNetwork || '').toLowerCase();
    if (dokodemoNetwork && !dokodemoNetwork.includes('tcp')) {
      return false;
    }
  }

  return true;
}

function isDokodemoUdpOnly(inbound) {
  const protocol = String(inbound?.protocol || '').toUpperCase();
  const dokodemoNetwork = String(inbound?.dokodemoNetwork || '').toLowerCase();
  return protocol === 'DOKODEMO_DOOR' && dokodemoNetwork && !dokodemoNetwork.includes('tcp');
}

function isDokodemoTcpForward(inbound) {
  const protocol = String(inbound?.protocol || '').toUpperCase();
  const dokodemoNetwork = String(inbound?.dokodemoNetwork || '').toLowerCase();
  return protocol === 'DOKODEMO_DOOR' && (!dokodemoNetwork || dokodemoNetwork.includes('tcp'));
}

function resolvePublicProbeHost() {
  const candidates = [
    process.env.SUBSCRIPTION_URL,
    process.env.APP_URL,
    process.env.PUBLIC_BASE_URL,
    env.SUBSCRIPTION_URL
  ];

  for (const candidate of candidates) {
    const raw = String(candidate || '').trim();
    if (!raw) {
      continue;
    }

    try {
      const parsed = new URL(raw);
      const host = normalizeEndpointHost(parsed.hostname);
      if (host) {
        return host;
      }
    } catch {
      const host = normalizeEndpointHost(raw);
      if (host) {
        return host;
      }
    }
  }

  return '';
}

function requiresServerTlsCertificate(inbound) {
  const protocol = String(inbound?.protocol || '').toUpperCase();
  const security = String(inbound?.security || '').toUpperCase();
  return protocol === 'TROJAN' || security === 'TLS';
}

/**
 * Resolve the host to use when probing xray inbound ports.
 * In Docker the backend container lives on a bridge network while xray uses
 * host networking, so 127.0.0.1 inside the container does not reach xray.
 * Set XRAY_HOST (e.g. "host.docker.internal") to override.
 */
function resolveXrayProbeHost() {
  const explicit = String(env.XRAY_HOST || '').trim();
  if (explicit) {
    return explicit;
  }
  try {
    const parsed = new URL(String(env.XRAY_API_URL || ''));
    const hostname = parsed.hostname;
    if (hostname && hostname !== '127.0.0.1' && hostname !== 'localhost') {
      return hostname;
    }
  } catch {
    // ignore
  }
  return '127.0.0.1';
}

function isLoopbackHost(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

function probeLocalTcpPort(port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const parsedPort = Number.parseInt(String(port || ''), 10);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      resolve({
        reachable: false,
        error: 'invalid-port',
        durationMs: 0
      });
      return;
    }

    const startedAt = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finalize = (reachable, errorCode = null) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve({
        reachable,
        error: errorCode,
        durationMs: Date.now() - startedAt
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finalize(true, null));
    socket.once('timeout', () => finalize(false, 'timeout'));
    socket.once('error', (error) => finalize(false, error?.code || error?.message || 'connect-error'));
    socket.connect(parsedPort, resolveXrayProbeHost());
  });
}

function probeTcpEndpoint(host, port, timeoutMs = 1800) {
  return new Promise((resolve) => {
    const targetHost = normalizeEndpointHost(host);
    const targetPort = Number.parseInt(String(port || ''), 10);
    if (!isValidEndpointHost(targetHost)) {
      resolve({
        reachable: false,
        error: 'invalid-host',
        durationMs: 0
      });
      return;
    }

    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
      resolve({
        reachable: false,
        error: 'invalid-port',
        durationMs: 0
      });
      return;
    }

    const startedAt = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finalize = (reachable, errorCode = null) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve({
        reachable,
        error: errorCode,
        durationMs: Date.now() - startedAt
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finalize(true, null));
    socket.once('timeout', () => finalize(false, 'timeout'));
    socket.once('error', (error) => finalize(false, error?.code || error?.message || 'connect-error'));
    socket.connect(targetPort, targetHost);
  });
}

function probeTlsEndpoint(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const targetHost = normalizeEndpointHost(host);
    const targetPort = Number.parseInt(String(port || ''), 10);
    if (!isValidEndpointHost(targetHost)) {
      resolve({
        reachable: false,
        error: 'invalid-host',
        durationMs: 0
      });
      return;
    }

    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
      resolve({
        reachable: false,
        error: 'invalid-port',
        durationMs: 0
      });
      return;
    }

    const startedAt = Date.now();
    let settled = false;
    const socket = tls.connect({
      host: targetHost,
      port: targetPort,
      servername: net.isIP(targetHost) ? undefined : targetHost,
      rejectUnauthorized: false,
      timeout: timeoutMs
    });

    const finalize = (reachable, errorCode = null) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.destroy();
      } catch (_error) {
        // ignore socket cleanup errors
      }
      resolve({
        reachable,
        error: errorCode,
        durationMs: Date.now() - startedAt
      });
    };

    socket.once('secureConnect', () => finalize(true, null));
    socket.once('timeout', () => finalize(false, 'timeout'));
    socket.once('error', (error) => finalize(false, error?.code || error?.message || 'tls-connect-error'));
  });
}

class UserService {
  async createUser({ email, dataLimit, expiryDays, inboundIds, note, ipLimit = 0, deviceLimit = 0, startOnFirstUse = false }) {
    if (!email) {
      throw new ValidationError('email is required');
    }

    const safeIpLimit = Number.parseInt(String(ipLimit), 10);
    const safeDeviceLimit = Number.parseInt(String(deviceLimit), 10);
    if (!Number.isInteger(safeIpLimit) || safeIpLimit < 0) {
      throw new ValidationError('ipLimit must be 0 or greater');
    }
    if (!Number.isInteger(safeDeviceLimit) || safeDeviceLimit < 0) {
      throw new ValidationError('deviceLimit must be 0 or greater');
    }

    const uuid = cryptoService.generateUUID();
    const password = cryptoService.generatePassword();
    const subscriptionToken = cryptoService.generateSubscriptionToken();

    const expireDate = new Date();
    const days = parsePositiveNumber(expiryDays, 30);
    expireDate.setDate(expireDate.getDate() + days);

    const inboundAssignments = await validateEnabledInboundAssignments(inboundIds, {
      requireAtLeastOne: true,
      allowAutoMyanmarDefaults: true
    });

    const user = await prisma.user.create({
      data: {
        email,
        uuid,
        password,
        subscriptionToken,
        dataLimit: gbToBytes(dataLimit),
        ipLimit: safeIpLimit,
        deviceLimit: safeDeviceLimit,
        startOnFirstUse: Boolean(startOnFirstUse),
        firstUsedAt: null,
        expireDate,
        note,
        inbounds: {
          create: inboundAssignments.map((assignment) => ({
            inboundId: assignment.inboundId,
            enabled: assignment.enabled,
            priority: assignment.priority
          }))
        }
      },
      include: {
        inbounds: {
          include: {
            inbound: true
          }
        }
      }
    });

    if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_DOMAIN && env.CLOUDFLARE_TARGET_IP) {
      try {
        const username = email.split('@')[0].replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
        const subdomain = `${username}.${env.CLOUDFLARE_DOMAIN}`;
        await cloudflareService.ensureRecord(subdomain, 'A', env.CLOUDFLARE_TARGET_IP, true);
        logger.info(`Automated Cloudflare domain routing configured for ${email} at ${subdomain}`);
      } catch (err) {
        logger.warn(`Failed to configure automated Cloudflare routing for ${email}: ${err.message}`);
      }
    }

    await reloadXrayIfEnabled('createUser');

    return user;
  }

  async getUsers({ page = 1, limit = 50, status, search }) {
    const parsedPage = Number.parseInt(page, 10);
    const parsedLimit = Number.parseInt(limit, 10);

    const safePage = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
    const safeLimit = Number.isNaN(parsedLimit) || parsedLimit < 1 ? 50 : Math.min(parsedLimit, 100);

    const skip = (safePage - 1) * safeLimit;

    const where = {};

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { uuid: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: safeLimit,
        include: {
          inbounds: {
            include: {
              inbound: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    return {
      users,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit)
      }
    };
  }

  async listUsers(params) {
    return this.getUsers(params || {});
  }

  async getUserById(id) {
    const user = await prisma.user.findUnique({
      where: { id: parseId(id) },
      include: {
        inbounds: {
          include: {
            inbound: true
          }
        }
      }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const totalUsed = user.uploadUsed + user.downloadUsed;
    const remaining = user.dataLimit - totalUsed;

    let remainingPercent = 0;
    if (user.dataLimit > 0n) {
      remainingPercent = Number((remaining * 10000n) / user.dataLimit) / 100;
    }

    const now = new Date();
    const isDeferredExpiry = Boolean(user.startOnFirstUse) && !user.firstUsedAt;
    const daysRemaining = isDeferredExpiry
      ? Math.max(1, Math.ceil((user.expireDate - user.createdAt) / (1000 * 60 * 60 * 24)))
      : Math.ceil((user.expireDate - now) / (1000 * 60 * 60 * 24));

    return {
      ...user,
      totalUsed,
      remaining,
      remainingPercent,
      daysRemaining
    };
  }

  async updateUser(id, updates) {
    const userId = parseId(id);
    const { email, dataLimit, expiryDays, inboundIds, note, status, ipLimit, deviceLimit, startOnFirstUse } = updates;

    const data = {};
    const requiresExistingUser = expiryDays !== undefined || startOnFirstUse !== undefined;
    const existingUser = requiresExistingUser
      ? await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, createdAt: true, expireDate: true, startOnFirstUse: true, firstUsedAt: true }
      })
      : null;

    if (requiresExistingUser && !existingUser) {
      throw new NotFoundError('User not found');
    }

    if (email !== undefined) data.email = email;
    if (dataLimit !== undefined) data.dataLimit = gbToBytes(dataLimit);
    if (note !== undefined) data.note = note;
    if (status !== undefined) data.status = status;
    if (ipLimit !== undefined) {
      const parsedIpLimit = Number.parseInt(String(ipLimit), 10);
      if (!Number.isInteger(parsedIpLimit) || parsedIpLimit < 0) {
        throw new ValidationError('ipLimit must be 0 or greater');
      }
      data.ipLimit = parsedIpLimit;
    }
    if (deviceLimit !== undefined) {
      const parsedDeviceLimit = Number.parseInt(String(deviceLimit), 10);
      if (!Number.isInteger(parsedDeviceLimit) || parsedDeviceLimit < 0) {
        throw new ValidationError('deviceLimit must be 0 or greater');
      }
      data.deviceLimit = parsedDeviceLimit;
    }

    const effectiveStartOnFirstUse = startOnFirstUse !== undefined
      ? Boolean(startOnFirstUse)
      : Boolean(existingUser?.startOnFirstUse);

    if (startOnFirstUse !== undefined) {
      if (existingUser?.firstUsedAt && effectiveStartOnFirstUse !== existingUser.startOnFirstUse) {
        throw new ValidationError('startOnFirstUse cannot be changed after the user has connected');
      }
      data.startOnFirstUse = effectiveStartOnFirstUse;
    }

    if (expiryDays !== undefined) {
      const days = parsePositiveNumber(expiryDays, 0);
      const shouldDeferExpiry = effectiveStartOnFirstUse && !existingUser?.firstUsedAt;

      if (shouldDeferExpiry) {
        // For deferred users, "expiryDays" represents the duration that starts on first connect.
        const expireDate = new Date(existingUser.createdAt);
        expireDate.setDate(expireDate.getDate() + days);
        data.expireDate = expireDate;
      } else {
        const expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + days);
        data.expireDate = expireDate;
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data,
      include: {
        inbounds: {
          include: {
            inbound: true
          }
        }
      }
    });

    if (inboundIds !== undefined) {
      const inboundAssignments = await validateEnabledInboundAssignments(inboundIds, {
        requireAtLeastOne: false,
        allowAutoMyanmarDefaults: false
      });

      await prisma.userInbound.deleteMany({
        where: { userId }
      });

      if (inboundAssignments.length > 0) {
        await prisma.userInbound.createMany({
          data: inboundAssignments.map((assignment) => ({
            userId,
            inboundId: assignment.inboundId,
            enabled: assignment.enabled,
            priority: assignment.priority
          }))
        });
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        inbounds: {
          include: {
            inbound: true
          }
        }
      }
    });

    await reloadXrayIfEnabled('updateUser');

    return user;
  }

  async setUserInboundEnabled(userId, inboundId, enabled) {
    const parsedUserId = parseId(userId);
    const parsedInboundId = parseId(inboundId);

    const existing = await prisma.userInbound.findUnique({
      where: {
        userId_inboundId: {
          userId: parsedUserId,
          inboundId: parsedInboundId
        }
      },
      include: {
        inbound: true
      }
    });

    if (!existing) {
      throw new NotFoundError('User access key not found');
    }

    const nextEnabled = typeof enabled === 'boolean' ? enabled : !existing.enabled;

    const updated = await prisma.userInbound.update({
      where: {
        userId_inboundId: {
          userId: parsedUserId,
          inboundId: parsedInboundId
        }
      },
      data: {
        enabled: nextEnabled
      },
      include: {
        inbound: true
      }
    });

    await reloadXrayIfEnabled('setUserInboundEnabled');

    return updated;
  }

  async setUserInboundPriority(userId, inboundId, priority) {
    const parsedUserId = parseId(userId);
    const parsedInboundId = parseId(inboundId);
    const parsedPriority = normalizePriority(priority);

    const existing = await prisma.userInbound.findUnique({
      where: {
        userId_inboundId: {
          userId: parsedUserId,
          inboundId: parsedInboundId
        }
      }
    });

    if (!existing) {
      throw new NotFoundError('User access key not found');
    }

    const updated = await prisma.userInbound.update({
      where: {
        userId_inboundId: {
          userId: parsedUserId,
          inboundId: parsedInboundId
        }
      },
      data: {
        priority: parsedPriority
      },
      include: {
        inbound: true
      }
    });

    await reloadXrayIfEnabled('setUserInboundPriority');

    return updated;
  }

  async reorderUserInbounds(userId, assignments = []) {
    const parsedUserId = parseId(userId);
    if (!Array.isArray(assignments) || assignments.length === 0) {
      throw new ValidationError('assignments must be a non-empty array');
    }

    const normalizedAssignments = normalizeInboundAssignments(assignments);
    if (normalizedAssignments.length === 0) {
      throw new ValidationError('assignments must contain valid inbound IDs');
    }

    const existing = await prisma.userInbound.findMany({
      where: { userId: parsedUserId },
      select: { inboundId: true }
    });
    const existingSet = new Set(existing.map((entry) => entry.inboundId));

    for (const assignment of normalizedAssignments) {
      if (!existingSet.has(assignment.inboundId)) {
        throw new ValidationError(`Inbound ${assignment.inboundId} is not assigned to this user`);
      }
    }

    await prisma.$transaction(
      normalizedAssignments.map((assignment) =>
        prisma.userInbound.update({
          where: {
            userId_inboundId: {
              userId: parsedUserId,
              inboundId: assignment.inboundId
            }
          },
          data: {
            priority: assignment.priority,
            enabled: assignment.enabled
          }
        })
      )
    );

    await reloadXrayIfEnabled('reorderUserInbounds');

    return prisma.userInbound.findMany({
      where: { userId: parsedUserId },
      include: {
        inbound: true
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
    });
  }

  async getUserInboundPatternPreview(userId, pattern = USER_INBOUND_PATTERN_MYANMAR) {
    const parsedUserId = parseId(userId);
    const normalizedPattern = normalizeInboundPattern(pattern);

    const user = await prisma.user.findUnique({
      where: { id: parsedUserId },
      select: {
        id: true,
        email: true,
        inbounds: {
          include: {
            inbound: {
              select: {
                id: true,
                tag: true,
                remark: true,
                protocol: true,
                network: true,
                security: true,
                port: true
              }
            }
          },
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
        }
      }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const plan = buildPatternReorderPlan(user.inbounds || [], normalizedPattern);

    return {
      userId: user.id,
      email: user.email,
      pattern: normalizedPattern,
      totalKeys: plan.totalKeys,
      matchedKeys: plan.matchedKeys,
      changedKeys: plan.changedKeys,
      currentTop3: plan.currentTop3,
      newTop3: plan.newTop3,
      assignments: plan.assignments,
      preview: plan.preview
    };
  }

  async reorderUserInboundsByPattern(userId, pattern = USER_INBOUND_PATTERN_MYANMAR, options = {}) {
    const normalizedPattern = normalizeInboundPattern(pattern);
    const dryRun = parseBooleanFlag(options?.dryRun, false);
    const preview = await this.getUserInboundPatternPreview(userId, normalizedPattern);

    if (dryRun || preview.changedKeys === 0) {
      return {
        ...preview,
        dryRun,
        applied: false,
        updatedCount: 0
      };
    }

    const parsedUserId = parseId(userId);

    await prisma.$transaction(
      preview.assignments.map((assignment) =>
        prisma.userInbound.update({
          where: {
            userId_inboundId: {
              userId: parsedUserId,
              inboundId: assignment.inboundId
            }
          },
          data: {
            priority: assignment.priority,
            enabled: assignment.enabled
          }
        })
      )
    );

    await reloadXrayIfEnabled('reorderUserInboundsByPattern');

    const relations = await prisma.userInbound.findMany({
      where: { userId: parsedUserId },
      include: {
        inbound: true
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
    });

    return {
      ...preview,
      dryRun: false,
      applied: true,
      updatedCount: preview.changedKeys,
      relations
    };
  }

  async getUserInboundQualityPreview(userId, options = {}) {
    const parsedUserId = parseId(userId);
    const windowMinutes = parseBoundedInt(options?.windowMinutes, { min: 5, max: 1440, fallback: 60 });

    const user = await prisma.user.findUnique({
      where: { id: parsedUserId },
      select: {
        id: true,
        email: true,
        inbounds: {
          include: {
            inbound: {
              select: {
                id: true,
                tag: true,
                remark: true,
                protocol: true,
                network: true,
                security: true,
                port: true
              }
            }
          },
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
        }
      }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const qualityMap = await connectionLogsService.getQualityByUsers([parsedUserId], windowMinutes);
    const quality = qualityMap.get(parsedUserId) || { byProfile: [] };

    const plan = buildQualityReorderPlan(user.inbounds || [], quality.byProfile || []);

    return {
      userId: user.id,
      email: user.email,
      windowMinutes,
      totalKeys: plan.totalKeys,
      scoredKeys: plan.scoredKeys,
      changedKeys: plan.changedKeys,
      currentTop3: plan.currentTop3,
      newTop3: plan.newTop3,
      assignments: plan.assignments,
      preview: plan.preview
    };
  }

  async reorderUserInboundsByQuality(userId, options = {}) {
    const dryRun = parseBooleanFlag(options?.dryRun, false);
    const preview = await this.getUserInboundQualityPreview(userId, options);

    if (dryRun || preview.changedKeys === 0) {
      return {
        ...preview,
        dryRun,
        applied: false,
        updatedCount: 0
      };
    }

    const parsedUserId = parseId(userId);

    await prisma.$transaction(
      preview.assignments.map((assignment) =>
        prisma.userInbound.update({
          where: {
            userId_inboundId: {
              userId: parsedUserId,
              inboundId: assignment.inboundId
            }
          },
          data: {
            priority: assignment.priority,
            enabled: assignment.enabled
          }
        })
      )
    );

    await reloadXrayIfEnabled('reorderUserInboundsByQuality');

    const relations = await prisma.userInbound.findMany({
      where: { userId: parsedUserId },
      include: {
        inbound: true
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
    });

    return {
      ...preview,
      dryRun: false,
      applied: true,
      updatedCount: preview.changedKeys,
      relations
    };
  }

  async bulkReorderUserInboundsByQuality(userIds, options = {}) {
    const parsedUserIds = normalizePositiveIdArray(userIds, 'userIds');
    const windowMinutes = parseBoundedInt(options?.windowMinutes, { min: 5, max: 1440, fallback: 60 });
    const dryRun = parseBooleanFlag(options?.dryRun, false);

    const users = await prisma.user.findMany({
      where: {
        id: {
          in: parsedUserIds
        }
      },
      select: {
        id: true,
        email: true,
        inbounds: {
          include: {
            inbound: {
              select: {
                id: true,
                tag: true,
                remark: true,
                protocol: true,
                network: true,
                security: true,
                port: true
              }
            }
          },
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
        }
      }
    });

    if (users.length !== parsedUserIds.length) {
      const existingIds = new Set(users.map((user) => user.id));
      const missingIds = parsedUserIds.filter((id) => !existingIds.has(id));
      throw new NotFoundError(`Users not found: ${missingIds.join(', ')}`);
    }

    const qualityMap = await connectionLogsService.getQualityByUsers(parsedUserIds, windowMinutes);

    const usersById = new Map(users.map((user) => [user.id, user]));
    const orderedUsers = parsedUserIds.map((id) => usersById.get(id)).filter(Boolean);

    const previewRows = [];
    const txUpdates = [];
    let wouldUpdateUsers = 0;
    let changedKeys = 0;
    let scoredKeys = 0;
    let totalKeys = 0;

    for (const user of orderedUsers) {
      const quality = qualityMap.get(user.id) || { byProfile: [] };
      const plan = buildQualityReorderPlan(user.inbounds || [], quality.byProfile || []);
      totalKeys += plan.totalKeys;
      changedKeys += plan.changedKeys;
      scoredKeys += plan.scoredKeys;

      if (plan.changedKeys > 0) {
        wouldUpdateUsers += 1;
      }

      previewRows.push({
        userId: user.id,
        email: user.email,
        totalKeys: plan.totalKeys,
        scoredKeys: plan.scoredKeys,
        changedKeys: plan.changedKeys,
        currentTop3: plan.currentTop3,
        newTop3: plan.newTop3
      });

      if (!dryRun && plan.changedKeys > 0) {
        for (const assignment of plan.assignments) {
          txUpdates.push(
            prisma.userInbound.update({
              where: {
                userId_inboundId: {
                  userId: user.id,
                  inboundId: assignment.inboundId
                }
              },
              data: {
                priority: assignment.priority,
                enabled: assignment.enabled
              }
            })
          );
        }
      }
    }

    if (!dryRun && txUpdates.length > 0) {
      await prisma.$transaction(txUpdates);
      await reloadXrayIfEnabled('bulkReorderUserInboundsByQuality');
    }

    return {
      windowMinutes,
      dryRun,
      summary: {
        targetUsers: parsedUserIds.length,
        wouldUpdateUsers,
        updatedUsers: dryRun ? 0 : wouldUpdateUsers,
        unchangedUsers: parsedUserIds.length - wouldUpdateUsers,
        totalKeys,
        scoredKeys,
        changedKeys
      },
      preview: previewRows.slice(0, 25),
      previewTruncated: previewRows.length > 25
    };
  }

  async bulkReorderUserInboundsByPattern(userIds, pattern = USER_INBOUND_PATTERN_MYANMAR, options = {}) {
    const parsedUserIds = normalizePositiveIdArray(userIds, 'userIds');
    const normalizedPattern = normalizeInboundPattern(pattern);
    const dryRun = parseBooleanFlag(options?.dryRun, false);

    const users = await prisma.user.findMany({
      where: {
        id: {
          in: parsedUserIds
        }
      },
      select: {
        id: true,
        email: true,
        inbounds: {
          include: {
            inbound: {
              select: {
                id: true,
                tag: true,
                remark: true,
                protocol: true,
                network: true,
                security: true,
                port: true
              }
            }
          },
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
        }
      }
    });

    if (users.length !== parsedUserIds.length) {
      const existingIds = new Set(users.map((user) => user.id));
      const missingIds = parsedUserIds.filter((id) => !existingIds.has(id));
      throw new NotFoundError(`Users not found: ${missingIds.join(', ')}`);
    }

    const usersById = new Map(users.map((user) => [user.id, user]));
    const orderedUsers = parsedUserIds.map((id) => usersById.get(id)).filter(Boolean);

    const previewRows = [];
    const txUpdates = [];
    let wouldUpdateUsers = 0;
    let changedKeys = 0;
    let matchedUsers = 0;
    let totalKeys = 0;

    for (const user of orderedUsers) {
      const plan = buildPatternReorderPlan(user.inbounds || [], normalizedPattern);
      totalKeys += plan.totalKeys;
      changedKeys += plan.changedKeys;

      if (plan.matchedKeys > 0) {
        matchedUsers += 1;
      }

      if (plan.changedKeys > 0) {
        wouldUpdateUsers += 1;
      }

      previewRows.push({
        userId: user.id,
        email: user.email,
        totalKeys: plan.totalKeys,
        matchedKeys: plan.matchedKeys,
        changedKeys: plan.changedKeys,
        currentTop3: plan.currentTop3,
        newTop3: plan.newTop3
      });

      if (!dryRun && plan.changedKeys > 0) {
        for (const assignment of plan.assignments) {
          txUpdates.push(
            prisma.userInbound.update({
              where: {
                userId_inboundId: {
                  userId: user.id,
                  inboundId: assignment.inboundId
                }
              },
              data: {
                priority: assignment.priority,
                enabled: assignment.enabled
              }
            })
          );
        }
      }
    }

    if (!dryRun && txUpdates.length > 0) {
      await prisma.$transaction(txUpdates);
      await reloadXrayIfEnabled('bulkReorderUserInboundsByPattern');
    }

    return {
      pattern: normalizedPattern,
      dryRun,
      summary: {
        targetUsers: parsedUserIds.length,
        matchedUsers,
        wouldUpdateUsers,
        updatedUsers: dryRun ? 0 : wouldUpdateUsers,
        unchangedUsers: parsedUserIds.length - wouldUpdateUsers,
        totalKeys,
        changedKeys
      },
      preview: previewRows.slice(0, 25),
      previewTruncated: previewRows.length > 25
    };
  }

  async deleteUser(id) {
    const userId = parseId(id);

    await prisma.user.delete({
      where: { id: userId }
    });

    ipTrackingService.clearUserConnections(userId);
    deviceTrackingService.clearUserDevices(userId);

    // Non-blocking Xray reload attempt
    try {
      // In CI/Test environments, we might want to skip this or make it non-blocking
      // to avoid timeouts if the xray process is slow to restart
      if (process.env.NODE_ENV === 'test' || process.env.CI) {
        reloadXrayIfEnabled('deleteUser').catch(err => {
          logger.warn('Background Xray reload failed during deleteUser', { error: err.message });
        });
      } else {
        await reloadXrayIfEnabled('deleteUser');
      }
    } catch (error) {
      logger.warn('Xray reload failed during deleteUser', { error: error.message });
    }

    return { id: userId };
  }

  async resetTraffic(id) {
    const user = await prisma.user.update({
      where: { id: parseId(id) },
      data: {
        uploadUsed: 0n,
        downloadUsed: 0n
      }
    });

    await xrayStatsCollector.resetUserStats(user.email || user.uuid);

    return user;
  }

  async extendExpiry(id, days) {
    const userId = parseId(id);
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const newExpireDate = new Date(user.expireDate);
    const parsedDays = parsePositiveNumber(days, 0);
    newExpireDate.setDate(newExpireDate.getDate() + parsedDays);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { expireDate: newExpireDate }
    });

    return updatedUser;
  }

  async getUserStats() {
    const [total, active, expired, disabled, trafficStats] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { status: 'EXPIRED' } }),
      prisma.user.count({ where: { status: 'DISABLED' } }),
      prisma.user.aggregate({
        _sum: {
          uploadUsed: true,
          downloadUsed: true
        }
      })
    ]);

    const totalUpload = trafficStats._sum.uploadUsed || 0n;
    const totalDownload = trafficStats._sum.downloadUsed || 0n;

    return {
      total,
      active,
      expired,
      disabled,
      totalUpload,
      totalDownload,
      totalTraffic: totalUpload + totalDownload
    };
  }

  async getUserTraffic(id, days = 30) {
    const userId = parseId(id);
    const safeDays = Number.isInteger(Number(days)) && Number(days) > 0 ? Number(days) : 30;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - safeDays);

    return prisma.trafficLog.findMany({
      where: {
        userId,
        timestamp: {
          gte: startDate
        }
      },
      orderBy: {
        timestamp: 'asc'
      }
    });
  }

  async getUserDevices(id, options = {}) {
    const userId = parseId(id);
    const windowMinutes = parseBoundedInt(options.windowMinutes, { min: 5, max: 1440, fallback: 60 });
    const staleThresholdMs = Math.max(
      5,
      Number(env.USER_ONLINE_DEVICE_TTL_SECONDS || env.USER_ONLINE_TTL_SECONDS || 60)
    ) * 1000;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, ipLimit: true, deviceLimit: true }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const since = new Date(Date.now() - windowMinutes * 60 * 1000);
    const logs = await prisma.connectionLog.findMany({
      where: {
        userId,
        timestamp: {
          gte: since
        }
      },
      include: {
        inbound: {
          select: {
            id: true,
            tag: true,
            protocol: true,
            port: true
          }
        }
      },
      orderBy: {
        timestamp: 'desc'
      },
      take: 3000
    });

    const now = Date.now();
    const byFingerprint = new Map();
    const inboundById = new Map();

    for (const log of logs) {
      const fingerprint = log.deviceFingerprint || `legacy-ip:${normalizeClientIp(log.clientIp) || 'unknown'}`;
      const existing = byFingerprint.get(fingerprint);

      if (!existing) {
        const ageMs = now - new Date(log.timestamp).getTime();
        if (log.inbound?.id) {
          inboundById.set(log.inbound.id, {
            id: log.inbound.id,
            tag: log.inbound.tag,
            protocol: log.inbound.protocol,
            port: log.inbound.port
          });
        }
        byFingerprint.set(fingerprint, {
          fingerprint,
          shortFingerprint: shortFingerprint(fingerprint),
          online: log.action === 'connect' && ageMs <= staleThresholdMs,
          lastSeenAt: log.timestamp.toISOString(),
          lastAction: log.action,
          clientIp: normalizeClientIp(log.clientIp) || null,
          userAgent: log.userAgent || null,
          inbound: log.inbound
            ? {
              id: log.inbound.id,
              tag: log.inbound.tag,
              protocol: log.inbound.protocol,
              port: log.inbound.port
            }
            : null,
          hitCount: 1
        });
        continue;
      }

      existing.hitCount += 1;
    }

    const activeInMemory = deviceTrackingService.getActiveDevices(userId);
    const missingInboundIds = new Set();
    for (const device of activeInMemory) {
      if (Number.isInteger(device.inboundId) && device.inboundId > 0 && !inboundById.has(device.inboundId)) {
        missingInboundIds.add(device.inboundId);
      }
    }

    if (missingInboundIds.size > 0) {
      const hydratedInbounds = await prisma.inbound.findMany({
        where: {
          id: {
            in: Array.from(missingInboundIds)
          }
        },
        select: {
          id: true,
          tag: true,
          protocol: true,
          port: true
        }
      });

      for (const inbound of hydratedInbounds) {
        inboundById.set(inbound.id, {
          id: inbound.id,
          tag: inbound.tag,
          protocol: inbound.protocol,
          port: inbound.port
        });
      }
    }

    for (const device of activeInMemory) {
      const existing = byFingerprint.get(device.fingerprint);
      const lastSeenAt = device.lastSeenAt ? new Date(device.lastSeenAt).toISOString() : new Date().toISOString();
      const inbound = Number.isInteger(device.inboundId) && device.inboundId > 0 ? inboundById.get(device.inboundId) : null;
      if (existing) {
        existing.online = true;
        existing.lastSeenAt = existing.lastSeenAt || lastSeenAt;
        existing.clientIp = existing.clientIp || normalizeClientIp(device.clientIp) || null;
        existing.userAgent = existing.userAgent || device.userAgent || null;
        if (!existing.inbound && inbound) {
          existing.inbound = inbound;
        }
      } else {
        byFingerprint.set(device.fingerprint, {
          fingerprint: device.fingerprint,
          shortFingerprint: shortFingerprint(device.fingerprint),
          online: true,
          lastSeenAt,
          lastAction: 'connect',
          clientIp: normalizeClientIp(device.clientIp) || null,
          userAgent: device.userAgent || null,
          inbound,
          hitCount: 1
        });
      }
    }

    const devices = Array.from(byFingerprint.values()).sort(
      (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
    );

    if (devices.length === 0 || !devices.some((device) => device.online)) {
      const recentTraffic = await prisma.trafficLog.findFirst({
        where: {
          userId,
          timestamp: {
            gte: since
          }
        },
        select: {
          timestamp: true,
          upload: true,
          download: true
        },
        orderBy: {
          timestamp: 'desc'
        }
      });

      const recentTrafficBytes =
        Number(recentTraffic?.upload || 0n) + Number(recentTraffic?.download || 0n);
      if (recentTraffic && recentTrafficBytes > 0) {
        const trafficSeenAt = recentTraffic.timestamp.toISOString();
        const trafficOnline = now - recentTraffic.timestamp.getTime() <= staleThresholdMs;
        devices.unshift({
          fingerprint: `traffic:${userId}`,
          shortFingerprint: 'traffic',
          online: trafficOnline,
          lastSeenAt: trafficSeenAt,
          lastAction: 'connect',
          clientIp: null,
          userAgent: 'xray-stats',
          inbound: null,
          hitCount: 1
        });
      }
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        ipLimit: user.ipLimit,
        deviceLimit: user.deviceLimit
      },
      windowMinutes,
      total: devices.length,
      online: devices.filter((device) => device.online).length,
      devices
    };
  }

  async revokeUserDevice(id, fingerprint) {
    const userId = parseId(id);
    const normalizedFingerprint = String(fingerprint || '').trim();

    if (!normalizedFingerprint || normalizedFingerprint.length < 8 || normalizedFingerprint.length > 128) {
      throw new ValidationError('fingerprint must be between 8 and 128 characters');
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });
    if (!existingUser) {
      throw new NotFoundError('User not found');
    }

    const inMemoryDevice = deviceTrackingService.releaseDevice(userId, normalizedFingerprint);
    if (inMemoryDevice?.clientIp) {
      const normalizedIp = normalizeClientIp(inMemoryDevice.clientIp);
      if (normalizedIp) {
        ipTrackingService.releaseConnection(userId, normalizedIp);
      }
    }

    const recentLog = await prisma.connectionLog.findFirst({
      where: {
        userId,
        deviceFingerprint: normalizedFingerprint
      },
      orderBy: {
        timestamp: 'desc'
      },
      select: {
        inboundId: true,
        clientIp: true,
        userAgent: true
      }
    });

    if (recentLog?.inboundId) {
      await connectionLogsService.log({
        userId,
        inboundId: recentLog.inboundId,
        clientIp: normalizeClientIp(inMemoryDevice?.clientIp || recentLog.clientIp) || 'unknown',
        deviceFingerprint: normalizedFingerprint,
        userAgent: inMemoryDevice?.userAgent || recentLog.userAgent || null,
        action: 'disconnect'
      });
    }

    return {
      userId,
      fingerprint: normalizedFingerprint,
      released: true
    };
  }

  async disconnectUserSessions(id) {
    const userId = parseId(id);

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });
    if (!existingUser) {
      throw new NotFoundError('User not found');
    }

    const activeDevices = deviceTrackingService.getActiveDevices(userId);
    const activeIps = ipTrackingService.getActiveIps(userId);
    const lookbackMs = Math.max(Math.max(5, Number(env.USER_ONLINE_TTL_SECONDS || 60)) * 1000 * 4, 15 * 60 * 1000);
    const since = new Date(Date.now() - lookbackMs);

    const recentConnectLogs = await prisma.connectionLog.findMany({
      where: {
        userId,
        action: 'connect',
        timestamp: {
          gte: since
        }
      },
      select: {
        inboundId: true,
        clientIp: true,
        deviceFingerprint: true,
        userAgent: true
      },
      orderBy: {
        timestamp: 'desc'
      },
      take: 1000
    });

    const disconnectEvents = new Map();
    const addDisconnectEvent = ({ inboundId, clientIp, deviceFingerprint, userAgent }) => {
      const normalizedIp = normalizeClientIp(clientIp) || null;
      const parsedInboundId = Number.parseInt(String(inboundId || ''), 10);
      if (!Number.isInteger(parsedInboundId) || parsedInboundId < 1 || !normalizedIp) {
        return;
      }

      const key = `${parsedInboundId}:${normalizedIp}`;
      if (!disconnectEvents.has(key)) {
        disconnectEvents.set(key, {
          inboundId: parsedInboundId,
          clientIp: normalizedIp,
          deviceFingerprint: deviceFingerprint || null,
          userAgent: userAgent || null
        });
      }
    };

    for (const device of activeDevices) {
      addDisconnectEvent({
        inboundId: device.inboundId,
        clientIp: device.clientIp,
        deviceFingerprint: device.fingerprint,
        userAgent: device.userAgent
      });
    }

    for (const log of recentConnectLogs) {
      addDisconnectEvent(log);
    }

    let disconnectLogCount = 0;
    for (const event of disconnectEvents.values()) {
      await connectionLogsService.log({
        userId,
        inboundId: event.inboundId,
        clientIp: event.clientIp,
        deviceFingerprint: event.deviceFingerprint,
        userAgent: event.userAgent,
        action: 'disconnect'
      });
      disconnectLogCount += 1;
    }

    deviceTrackingService.clearUserDevices(userId);
    ipTrackingService.clearUserConnections(userId);
    await onlineTracker.refresh(true);

    return {
      userId,
      disconnectedDevices: activeDevices.length,
      disconnectedIps: activeIps.length,
      disconnectLogsWritten: disconnectLogCount
    };
  }

  async getSessionSnapshots({ userIds = [], includeOffline = true, limit = 200 } = {}) {
    const ids = Array.isArray(userIds) ? userIds.map((userId) => parseId(userId)) : [];
    const safeLimit = parseBoundedInt(limit, { min: 1, max: 500, fallback: 200 });
    const includeOfflineSessions = parseBooleanFlag(includeOffline, true);

    const users = await prisma.user.findMany({
      where: ids.length > 0 ? { id: { in: ids } } : undefined,
      ...(ids.length === 0 ? { take: safeLimit } : {}),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        uuid: true,
        status: true,
        inbounds: {
          where: { enabled: true },
          select: {
            inbound: {
              select: {
                id: true,
                tag: true,
                protocol: true,
                port: true
              }
            }
          }
        }
      }
    });

    if (users.length === 0) {
      return {
        total: 0,
        online: 0,
        sessions: [],
        generatedAt: new Date().toISOString()
      };
    }

    const userIdSet = users.map((user) => user.id);

    const [heartbeatByUserId, recentConnections, qualityByUserId] = await Promise.all([
      onlineTracker.getHeartbeatMapByUserId(userIdSet),
      prisma.connectionLog.findMany({
        where: {
          userId: {
            in: userIdSet
          }
        },
        include: {
          inbound: {
            select: {
              id: true,
              tag: true,
              protocol: true,
              port: true
            }
          }
        },
        orderBy: {
          timestamp: 'desc'
        },
        take: Math.min(userIdSet.length * 5, 5000)
      }),
      connectionLogsService.getQualityByUsers(userIdSet, 60)
    ]);

    const latestConnectionByUserId = new Map();
    for (const connection of recentConnections) {
      if (!latestConnectionByUserId.has(connection.userId)) {
        latestConnectionByUserId.set(connection.userId, connection);
      }
    }

    const sessions = users.map((user) => {
      const heartbeat = heartbeatByUserId.get(user.id) || null;
      const latestConnection = latestConnectionByUserId.get(user.id) || null;
      const fallbackInbound = user.inbounds?.[0]?.inbound || null;
      const activeInbound = heartbeat?.currentInbound || latestConnection?.inbound || fallbackInbound;
      const lastSeenAt = heartbeat?.lastActivity
        ? new Date(heartbeat.lastActivity).toISOString()
        : latestConnection?.timestamp
          ? latestConnection.timestamp.toISOString()
          : null;
      const lastPacketSeenAt = heartbeat?.lastPacketSeenAt
        ? new Date(heartbeat.lastPacketSeenAt).toISOString()
        : lastSeenAt;
      const online = Boolean(heartbeat?.online);
      const activeKeyCount = user.inbounds.length;
      const onlineKeyCount = Number.isInteger(heartbeat?.onlineKeyCount)
        ? heartbeat.onlineKeyCount
        : online
          ? 1
          : 0;
      const quality = qualityByUserId.get(user.id) || {
        connectSuccesses: 0,
        limitRejects: 0,
        reconnects: 0,
        reconnectFrequencyPerHour: 0,
        avgTrafficPerMinute: 0,
        byProtocol: [],
        byProfile: []
      };

      return {
        userId: user.id,
        uuid: user.uuid,
        email: user.email,
        status: user.status,
        online,
        state: heartbeat?.state || (online ? 'online' : latestConnection?.action === 'connect' ? 'idle' : 'offline'),
        lastSeenAt,
        lastPacketSeenAt,
        lastAction: heartbeat?.lastAction || latestConnection?.action || null,
        currentIp: heartbeat?.currentIp || latestConnection?.clientIp || null,
        currentInbound: activeInbound
          ? {
            id: activeInbound.id,
            tag: activeInbound.tag,
            protocol: activeInbound.protocol,
            port: activeInbound.port
          }
          : null,
        protocol: heartbeat?.protocol || activeInbound?.protocol || null,
        upload: Number(heartbeat?.upload || 0),
        download: Number(heartbeat?.download || 0),
        activeKeyCount,
        onlineKeyCount,
        quality
      };
    });

    const filteredSessions = includeOfflineSessions ? sessions : sessions.filter((session) => session.online);

    return {
      total: sessions.length,
      online: sessions.filter((session) => session.online).length,
      sessions: filteredSessions,
      generatedAt: new Date().toISOString()
    };
  }

  async getUserSessionSnapshot(id) {
    const userId = parseId(id);
    const snapshot = await this.getSessionSnapshots({
      userIds: [userId],
      includeOffline: true
    });

    if (snapshot.sessions.length === 0) {
      throw new NotFoundError('User not found');
    }

    return snapshot.sessions[0];
  }

  async getTelemetrySyncStatus() {
    const [activeUsers, activeUserInbounds] = await Promise.all([
      prisma.user.count({
        where: {
          status: 'ACTIVE'
        }
      }),
      prisma.userInbound.count({
        where: {
          enabled: true,
          inbound: {
            enabled: true
          }
        }
      })
    ]);

    const sync = xrayStatsCollector.getSyncStatus();

    return {
      ...sync,
      activeUsers,
      activeUserInbounds,
      generatedAt: new Date().toISOString()
    };
  }

  async runUserDiagnostics(id, options = {}) {
    const userId = parseId(id);
    const windowMinutes = parseBoundedInt(options.windowMinutes, { min: 5, max: 1440, fallback: 60 });
    const portProbeTimeoutMs = parseBoundedInt(options.portProbeTimeoutMs, { min: 300, max: 5000, fallback: 1200 });
    const endpointProbeTimeoutMs = parseBoundedInt(options.endpointProbeTimeoutMs, { min: 300, max: 8000, fallback: 1800 });
    const realityDestProbeTimeoutMs = parseBoundedInt(options.realityDestProbeTimeoutMs, { min: 500, max: 10000, fallback: 2500 });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        inbounds: {
          include: {
            inbound: true
          },
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
        }
      }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const checks = [];
    const recommendedActions = new Set();
    const pushCheck = (check) => {
      checks.push(check);
      if (check.status !== 'PASS' && check.recommendedAction) {
        recommendedActions.add(check.recommendedAction);
      }
    };

    const [xrayStatus, sessionSnapshot, devicesSnapshot] = await Promise.all([
      xrayManager.getStatus().catch((error) => ({
        running: false,
        error: error?.message || 'Failed to query Xray status'
      })),
      this.getSessionSnapshots({
        userIds: [userId],
        includeOffline: true,
        limit: 1
      }).catch(() => ({
        sessions: []
      })),
      this.getUserDevices(userId, { windowMinutes }).catch(() => ({
        windowMinutes,
        total: 0,
        online: 0,
        devices: []
      }))
    ]);

    const telemetry = xrayStatsCollector.getSyncStatus();
    const session = sessionSnapshot?.sessions?.[0] || null;
    const assignedInbounds = Array.isArray(user.inbounds) ? user.inbounds : [];
    const enabledRelations = assignedInbounds.filter((row) => row.enabled && row.inbound?.enabled);

    pushCheck({
      id: 'xray-runtime',
      label: 'Xray runtime',
      status: xrayStatus?.running ? 'PASS' : 'FAIL',
      details: xrayStatus?.running
        ? 'Xray process is running.'
        : `Xray process is not running${xrayStatus?.error ? ` (${xrayStatus.error})` : ''}.`,
      recommendedAction: xrayStatus?.running
        ? null
        : 'Restart Xray runtime from Settings -> Xray Runtime, then verify inbound ports are listening.'
    });

    const telemetryStatus = String(telemetry.status || 'unknown');
    pushCheck({
      id: 'telemetry-sync',
      label: 'Telemetry sync',
      status:
        telemetryStatus === 'healthy'
          ? 'PASS'
          : telemetryStatus === 'degraded' || telemetryStatus === 'stale' || telemetryStatus === 'starting'
            ? 'WARN'
            : 'FAIL',
      details: `Collector status is "${telemetryStatus}" (transport: ${telemetry.transport || 'unknown'}).`,
      recommendedAction:
        telemetryStatus === 'healthy'
          ? null
          : 'Check XRAY_API_URL/XRAY_API_SERVER and run Settings -> Xray Runtime -> Reload Config.'
    });

    pushCheck({
      id: 'assigned-keys',
      label: 'Assigned keys',
      status: enabledRelations.length > 0 ? 'PASS' : 'FAIL',
      details:
        enabledRelations.length > 0
          ? `${enabledRelations.length} enabled key(s) are assigned to this user.`
          : 'No enabled keys are assigned to this user.',
      recommendedAction:
        enabledRelations.length > 0 ? null : 'Assign at least one enabled inbound to this user.'
    });

    if (session?.online) {
      pushCheck({
        id: 'live-session',
        label: 'Live session',
        status: 'PASS',
        details: `User is online${session.currentIp ? ` from ${session.currentIp}` : ''}.`,
        recommendedAction: null
      });
    } else {
      pushCheck({
        id: 'live-session',
        label: 'Live session',
        status: 'WARN',
        details: 'No active session detected for this user right now.',
        recommendedAction: 'If the user cannot connect, regenerate subscription and re-import profile in the client app.'
      });
    }

    const uniquePorts = Array.from(
      new Set(
        enabledRelations
          .filter((row) => row.inbound && !isDokodemoUdpOnly(row.inbound) && String(row.inbound.protocol || '').toUpperCase() !== 'WIREGUARD')
          .map((row) => Number.parseInt(String(row.inbound?.port || ''), 10))
          .filter((port) => Number.isInteger(port) && port > 0)
      )
    );

    const portProbeByPort = new Map();
    await Promise.all(
      uniquePorts.map(async (port) => {
        const result = await probeLocalTcpPort(port, portProbeTimeoutMs);
        portProbeByPort.set(port, result);
      })
    );

    const endpointTargets = Array.from(
      new Set(
        enabledRelations
          .map((relation) => relation.inbound)
          .filter((inbound) => inbound && shouldProbeInboundTcpEndpoint(inbound))
          .map((inbound) => resolveInboundEndpoint(inbound))
          .filter((endpoint) => endpoint.host && endpoint.port > 0)
          .map((endpoint) => `${endpoint.host}:${endpoint.port}`)
      )
    );
    const endpointProbeByTarget = new Map();
    await Promise.all(
      endpointTargets.map(async (target) => {
        const parsed = parseEndpointHostPort(target, 0);
        const result = await probeTcpEndpoint(parsed.host, parsed.port, endpointProbeTimeoutMs);
        endpointProbeByTarget.set(target, result);
      })
    );

    const realityDestTargets = Array.from(
      new Set(
        enabledRelations
          .map((relation) => relation.inbound)
          .filter((inbound) => inbound && String(inbound.security || '').toUpperCase() === 'REALITY')
          .map((inbound) => normalizeDestHostPort(inbound.realityDest, 443))
          .filter((dest) => dest.host && dest.port > 0)
          .map((dest) => `${dest.host}:${dest.port}`)
      )
    );
    const realityDestProbeByTarget = new Map();
    await Promise.all(
      realityDestTargets.map(async (target) => {
        const parsed = parseEndpointHostPort(target, 443);
        const result = await probeTlsEndpoint(parsed.host, parsed.port, realityDestProbeTimeoutMs);
        realityDestProbeByTarget.set(target, result);
      })
    );

    for (const relation of enabledRelations) {
      const inbound = relation.inbound;
      if (!inbound) {
        continue;
      }

      const protocol = String(inbound.protocol || '').toUpperCase();
      const network = String(inbound.network || '').toUpperCase();
      const security = String(inbound.security || '').toUpperCase();
      const keyLabel = inbound.remark || inbound.tag || `${protocol}:${inbound.port}`;
      const port = Number.parseInt(String(inbound.port || ''), 10);
      const portProbe = portProbeByPort.get(port);
      const endpoint = resolveInboundEndpoint(inbound);
      const endpointTarget = endpoint.host && endpoint.port > 0 ? `${endpoint.host}:${endpoint.port}` : null;
      const endpointProbe = endpointTarget ? endpointProbeByTarget.get(endpointTarget) : null;
      const probeHost = resolveXrayProbeHost();
      const tlsInboundBlockedByPanelSsl = requiresServerTlsCertificate(inbound) && !env.SSL_ENABLED;
      const dokodemoUdpOnly = isDokodemoUdpOnly(inbound);
      const dokodemoTcpForward = isDokodemoTcpForward(inbound);
      const localProbeFailedButEndpointReachable =
        !portProbe?.reachable &&
        Boolean(endpointProbe?.reachable) &&
        (portProbe?.error === 'ECONNREFUSED' || portProbe?.error === 'timeout');
      const dokodemoForwardProbeLimited =
        dokodemoTcpForward &&
        !portProbe?.reachable &&
        !endpointProbe?.reachable &&
        (portProbe?.error === 'ECONNREFUSED' || portProbe?.error === 'timeout' || !portProbe) &&
        (endpointProbe?.error === 'ECONNREFUSED' || endpointProbe?.error === 'timeout' || !endpointProbe);
      const portCheckStatus = portProbe?.reachable || localProbeFailedButEndpointReachable ? 'PASS' : 'FAIL';
      const portCheckDetails = portProbe?.reachable
        ? isLoopbackHost(probeHost)
          ? `Port ${port} is listening locally (${portProbe.durationMs}ms).`
          : `Port ${port} is reachable via ${probeHost} (${portProbe.durationMs}ms).`
        : localProbeFailedButEndpointReachable
          ? isLoopbackHost(probeHost)
            ? `Loopback probe for port ${port} failed${portProbe?.error ? ` (${portProbe.error})` : ''}, but ${endpointTarget} is reachable from the server. This is expected when the backend and Xray run in different Docker network namespaces.`
            : `Probe via ${probeHost} failed for port ${port}${portProbe?.error ? ` (${portProbe.error})` : ''}, but ${endpointTarget} is reachable from the server.`
          : isLoopbackHost(probeHost)
            ? `Port ${port} is not reachable locally${portProbe?.error ? ` (${portProbe.error})` : ''}.`
            : `Port ${port} is not reachable via ${probeHost}${portProbe?.error ? ` (${portProbe.error})` : ''}.`;

      if (dokodemoUdpOnly) {
        pushCheck({
          id: `inbound:${inbound.id}:port`,
          label: `Inbound ${keyLabel} port`,
          status: 'WARN',
          details: `UDP-only inbound "${keyLabel}" uses port ${port}; TCP port probe was skipped.`,
          recommendedAction: `Validate UDP ${port} on host firewall/cloud security groups and confirm clients can reach inbound "${keyLabel}".`
        });
      } else if (tlsInboundBlockedByPanelSsl) {
        pushCheck({
          id: `inbound:${inbound.id}:port`,
          label: `Inbound ${keyLabel} port`,
          status: 'WARN',
          details: `TLS inbound "${keyLabel}" is not deployed because panel SSL is disabled and no server certificate/key is configured.`,
          recommendedAction: `Enable SSL and install a valid certificate for "${keyLabel}", or disable/remove this TLS inbound.`
        });
      } else if (dokodemoForwardProbeLimited) {
        pushCheck({
          id: `inbound:${inbound.id}:port`,
          label: `Inbound ${keyLabel} port`,
          status: 'WARN',
          details: `TCP forward inbound "${keyLabel}" could not be verified from the panel container. This is common when dokodemo-door listeners run in a different Docker/network namespace.`,
          recommendedAction: `Validate TCP ${port} from the VPS host or an external client and confirm inbound "${keyLabel}" is still listening.`
        });
      } else {
        pushCheck({
          id: `inbound:${inbound.id}:port`,
          label: `Inbound ${keyLabel} port`,
          status: portCheckStatus,
          details: portCheckDetails,
          recommendedAction: portCheckStatus === 'PASS'
            ? null
            : `Ensure inbound "${keyLabel}" is enabled and open TCP ${port} on host firewall/cloud security groups.`
        });
      }

      if (shouldProbeInboundTcpEndpoint(inbound)) {
        if (!endpoint.host || !endpoint.port) {
          pushCheck({
            id: `inbound:${inbound.id}:endpoint`,
            label: `Inbound ${keyLabel} advertised endpoint`,
            status: 'WARN',
            details: 'Endpoint host/port is missing in inbound settings.',
            recommendedAction: `Set serverAddress and port for inbound "${keyLabel}" so clients can reach the advertised endpoint.`
          });
        } else if (!isValidEndpointHost(endpoint.host)) {
          pushCheck({
            id: `inbound:${inbound.id}:endpoint`,
            label: `Inbound ${keyLabel} advertised endpoint`,
            status: 'FAIL',
            details: `Endpoint host "${endpoint.host}" is invalid.`,
            recommendedAction: `Fix serverAddress for inbound "${keyLabel}" to a valid domain or public IP.`
          });
        } else if (tlsInboundBlockedByPanelSsl) {
          pushCheck({
            id: `inbound:${inbound.id}:endpoint`,
            label: `Inbound ${keyLabel} advertised endpoint`,
            status: 'WARN',
            details: `${endpointTarget} is not reachable because inbound "${keyLabel}" was skipped while panel SSL is disabled.`,
            recommendedAction: `Enable SSL with a valid certificate for "${keyLabel}", or disable/remove this TLS inbound.`
          });
        } else if (dokodemoForwardProbeLimited) {
          pushCheck({
            id: `inbound:${inbound.id}:endpoint`,
            label: `Inbound ${keyLabel} advertised endpoint`,
            status: 'WARN',
            details: `${endpointTarget} could not be verified from the panel container. Dokodemo TCP forwards can still work even when this probe times out.`,
            recommendedAction: `Test ${endpointTarget} from the VPS host or an external client and confirm the forwarding target for "${keyLabel}" is correct.`
          });
        } else {
          pushCheck({
            id: `inbound:${inbound.id}:endpoint`,
            label: `Inbound ${keyLabel} advertised endpoint`,
            status: endpointProbe?.reachable ? 'PASS' : 'FAIL',
            details: endpointProbe?.reachable
              ? `${endpointTarget} is reachable from the server (${endpointProbe.durationMs}ms).`
              : `${endpointTarget} is not reachable from the server${endpointProbe?.error ? ` (${endpointProbe.error})` : ''}.`,
            recommendedAction: endpointProbe?.reachable
              ? null
              : `Open firewall/cloud security group for ${endpointTarget} and confirm reverse-proxy pass-through routes to inbound "${keyLabel}".`
          });
        }
      } else if (protocol === 'WIREGUARD') {
        pushCheck({
          id: `inbound:${inbound.id}:wireguard-udp`,
          label: `Inbound ${keyLabel} WireGuard endpoint`,
          status: 'WARN',
          details: `WireGuard uses UDP on ${endpoint.host || 'server'}:${endpoint.port || 51820}; TCP probe skipped.`,
          recommendedAction: `Validate UDP ${endpoint.port || 51820} is open externally and client peer endpoint matches "${endpoint.host || inbound.serverAddress}".`
        });
      }

      if (security === 'REALITY') {
        const hasRealityKeys = Boolean(inbound.realityPublicKey && inbound.realityPrivateKey);
        const hasShortIds = Array.isArray(inbound.realityShortIds) && inbound.realityShortIds.length > 0;
        const hasServerNames = Array.isArray(inbound.realityServerNames) && inbound.realityServerNames.length > 0;
        const { host: realityDestHost, port: realityDestPort } = normalizeDestHostPort(inbound.realityDest, 443);
        const hasRealityDest = Boolean(realityDestHost && realityDestPort);
        const realityDestTarget = hasRealityDest ? `${realityDestHost}:${realityDestPort}` : null;
        const realityDestProbe = realityDestTarget ? realityDestProbeByTarget.get(realityDestTarget) : null;

        pushCheck({
          id: `inbound:${inbound.id}:reality`,
          label: `Inbound ${keyLabel} REALITY config`,
          status: hasRealityKeys && hasShortIds && hasServerNames && hasRealityDest ? 'PASS' : 'FAIL',
          details:
            hasRealityKeys && hasShortIds && hasServerNames && hasRealityDest
              ? 'REALITY keys, short IDs, server names, and destination are configured.'
              : 'REALITY inbound is missing key fields (keys/shortIds/serverNames/destination).',
          recommendedAction:
            hasRealityKeys && hasShortIds && hasServerNames && hasRealityDest
              ? null
              : `Open inbound "${keyLabel}" and regenerate REALITY keys plus destination/server names.`
        });

        if (hasRealityDest) {
          pushCheck({
            id: `inbound:${inbound.id}:reality-destination`,
            label: `Inbound ${keyLabel} REALITY destination`,
            status: realityDestProbe?.reachable ? 'PASS' : 'FAIL',
            details: realityDestProbe?.reachable
              ? `Destination ${realityDestTarget} is reachable over TLS (${realityDestProbe.durationMs}ms).`
              : `Destination ${realityDestTarget} is not reachable over TLS${realityDestProbe?.error ? ` (${realityDestProbe.error})` : ''}.`,
            recommendedAction: realityDestProbe?.reachable
              ? null
              : `Switch REALITY destination for "${keyLabel}" to a reachable host (for example www.microsoft.com:443) and retry.`
          });
        }
      }

      if (security === 'TLS' && !String(inbound.serverName || '').trim()) {
        pushCheck({
          id: `inbound:${inbound.id}:tls-sni`,
          label: `Inbound ${keyLabel} TLS SNI`,
          status: 'WARN',
          details: 'TLS inbound has empty Server Name (SNI).',
          recommendedAction: `Set Server Name on inbound "${keyLabel}" to match your certificate/domain.`
        });
      }

      if (network === 'WS' && !String(inbound.wsPath || '').trim()) {
        pushCheck({
          id: `inbound:${inbound.id}:ws-path`,
          label: `Inbound ${keyLabel} WebSocket path`,
          status: 'WARN',
          details: 'WebSocket inbound has empty path.',
          recommendedAction: `Set a non-obvious WebSocket path for inbound "${keyLabel}" (for example /api/v1/stream).`
        });
      }

      if (protocol === 'TROJAN' && !String(user.password || '').trim()) {
        pushCheck({
          id: `inbound:${inbound.id}:trojan-password`,
          label: `Inbound ${keyLabel} Trojan secret`,
          status: 'FAIL',
          details: 'User Trojan password is missing.',
          recommendedAction: 'Rotate user credentials to regenerate a Trojan password.'
        });
      }
    }

    if (devicesSnapshot?.online > 0) {
      pushCheck({
        id: 'device-session',
        label: 'Device sessions',
        status: 'PASS',
        details: `${devicesSnapshot.online} online device(s), ${devicesSnapshot.total} seen in ${windowMinutes}m.`,
        recommendedAction: null
      });
    } else {
      pushCheck({
        id: 'device-session',
        label: 'Device sessions',
        status: 'WARN',
        details: `No online devices detected in the last ${windowMinutes} minutes.`,
        recommendedAction: 'Ask the user to reconnect and verify session/device tracking endpoints.'
      });
    }

    const summary = checks.reduce(
      (acc, check) => {
        const key = check.status === 'PASS' ? 'pass' : check.status === 'WARN' ? 'warn' : 'fail';
        acc[key] += 1;
        acc.total += 1;
        return acc;
      },
      { pass: 0, warn: 0, fail: 0, total: 0 }
    );

    return {
      userId: user.id,
      email: user.email,
      generatedAt: new Date().toISOString(),
      summary,
      context: {
        userStatus: user.status,
        online: Boolean(session?.online),
        currentIp: session?.currentIp || null,
        telemetryStatus: telemetryStatus,
        xrayRunning: Boolean(xrayStatus?.running),
        enabledKeys: enabledRelations.length,
        onlineDevices: Number(devicesSnapshot?.online || 0),
        seenDevices: Number(devicesSnapshot?.total || 0)
      },
      checks,
      recommendedActions: Array.from(recommendedActions)
    };
  }

  async rotateUserKeys(id, options = {}) {
    const userId = parseId(id);
    const rotateUuid = parseBooleanFlag(options.rotateUuid, true);
    const rotatePassword = parseBooleanFlag(options.rotatePassword, true);
    const rotateSubscriptionToken = parseBooleanFlag(options.rotateSubscriptionToken, true);
    const reactivate = parseBooleanFlag(options.reactivate, false);
    const resetTraffic = parseBooleanFlag(options.resetTraffic, false);

    if (!rotateUuid && !rotatePassword && !rotateSubscriptionToken && !reactivate && !resetTraffic) {
      throw new ValidationError('At least one key lifecycle option is required');
    }

    const data = {};
    if (rotateUuid) {
      data.uuid = cryptoService.generateUUID();
    }
    if (rotatePassword) {
      data.password = cryptoService.generatePassword();
    }
    if (rotateSubscriptionToken) {
      data.subscriptionToken = cryptoService.generateSubscriptionToken();
    }
    if (reactivate) {
      data.status = 'ACTIVE';
    }
    if (resetTraffic) {
      data.uploadUsed = 0n;
      data.downloadUsed = 0n;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      include: {
        inbounds: {
          include: {
            inbound: true
          }
        }
      }
    });

    if (resetTraffic) {
      await xrayStatsCollector.resetUserStats(updated.email || updated.uuid);
    }

    await reloadXrayIfEnabled('rotateUserKeys');

    return updated;
  }

  async regenerateSubscriptionToken(id) {
    const userId = parseId(id);
    const updated = await this.rotateUserKeys(userId, {
      rotateUuid: false,
      rotatePassword: false,
      rotateSubscriptionToken: true,
      reactivate: false,
      resetTraffic: false
    });

    return {
      id: updated.id,
      email: updated.email,
      subscriptionToken: updated.subscriptionToken
    };
  }

  async revokeUserKeys(id, options = {}) {
    const userId = parseId(id);
    const disableUser = parseBooleanFlag(options.disableUser, true);
    const disableInbounds = parseBooleanFlag(options.disableInbounds, true);
    const revokeSubscription = parseBooleanFlag(options.revokeSubscription, true);
    const rotateCredentials = parseBooleanFlag(options.rotateCredentials, false);

    if (!disableUser && !disableInbounds && !revokeSubscription && !rotateCredentials) {
      throw new ValidationError('At least one revoke option is required');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true
      }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const updateData = {};

    if (disableUser) {
      updateData.status = 'DISABLED';
    }
    if (revokeSubscription) {
      updateData.subscriptionToken = cryptoService.generateSubscriptionToken();
    }
    if (rotateCredentials) {
      updateData.uuid = cryptoService.generateUUID();
      updateData.password = cryptoService.generatePassword();
    }

    await prisma.$transaction(async (tx) => {
      if (disableInbounds) {
        await tx.userInbound.updateMany({
          where: { userId },
          data: { enabled: false }
        });
      }

      if (Object.keys(updateData).length > 0) {
        await tx.user.update({
          where: { id: userId },
          data: updateData
        });
      }
    });

    const updated = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        inbounds: {
          include: {
            inbound: true
          }
        }
      }
    });

    await reloadXrayIfEnabled('revokeUserKeys');

    return updated;
  }

  async bulkRotateUserKeys(userIds, options = {}) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new ValidationError('userIds must be a non-empty array');
    }

    const ids = userIds.map((id) => parseId(id));
    const rotateUuid = parseBooleanFlag(options.rotateUuid, true);
    const rotatePassword = parseBooleanFlag(options.rotatePassword, true);
    const rotateSubscriptionToken = parseBooleanFlag(options.rotateSubscriptionToken, true);
    const reactivate = parseBooleanFlag(options.reactivate, false);
    const resetTraffic = parseBooleanFlag(options.resetTraffic, false);

    if (!rotateUuid && !rotatePassword && !rotateSubscriptionToken && !reactivate && !resetTraffic) {
      throw new ValidationError('At least one key lifecycle option is required');
    }

    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        email: true,
        uuid: true
      }
    });

    if (users.length !== ids.length) {
      throw new ValidationError('One or more userIds are invalid');
    }

    const updatedUsers = [];

    for (const user of users) {
      const data = {};

      if (rotateUuid) {
        data.uuid = cryptoService.generateUUID();
      }
      if (rotatePassword) {
        data.password = cryptoService.generatePassword();
      }
      if (rotateSubscriptionToken) {
        data.subscriptionToken = cryptoService.generateSubscriptionToken();
      }
      if (reactivate) {
        data.status = 'ACTIVE';
      }
      if (resetTraffic) {
        data.uploadUsed = 0n;
        data.downloadUsed = 0n;
      }

      const updated = await prisma.user.update({
        where: { id: user.id },
        data,
        select: {
          id: true,
          email: true,
          uuid: true,
          password: true,
          subscriptionToken: true,
          status: true
        }
      });

      if (resetTraffic) {
        await xrayStatsCollector.resetUserStats(user.email || user.uuid);
      }

      updatedUsers.push(updated);
    }

    await reloadXrayIfEnabled('bulkRotateUserKeys');

    return {
      updatedCount: updatedUsers.length,
      users: updatedUsers
    };
  }

  async bulkRevokeUserKeys(userIds, options = {}) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new ValidationError('userIds must be a non-empty array');
    }

    const ids = userIds.map((id) => parseId(id));
    const disableUser = parseBooleanFlag(options.disableUser, true);
    const disableInbounds = parseBooleanFlag(options.disableInbounds, true);
    const revokeSubscription = parseBooleanFlag(options.revokeSubscription, true);
    const rotateCredentials = parseBooleanFlag(options.rotateCredentials, false);

    if (!disableUser && !disableInbounds && !revokeSubscription && !rotateCredentials) {
      throw new ValidationError('At least one revoke option is required');
    }

    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        email: true,
        uuid: true
      }
    });

    if (users.length !== ids.length) {
      throw new ValidationError('One or more userIds are invalid');
    }

    if (disableInbounds) {
      await prisma.userInbound.updateMany({
        where: {
          userId: {
            in: ids
          }
        },
        data: {
          enabled: false
        }
      });
    }

    for (const user of users) {
      const data = {};

      if (disableUser) {
        data.status = 'DISABLED';
      }
      if (revokeSubscription) {
        data.subscriptionToken = cryptoService.generateSubscriptionToken();
      }
      if (rotateCredentials) {
        data.uuid = cryptoService.generateUUID();
        data.password = cryptoService.generatePassword();
      }

      if (Object.keys(data).length > 0) {
        await prisma.user.update({
          where: { id: user.id },
          data
        });
      }
    }

    await reloadXrayIfEnabled('bulkRevokeUserKeys');

    return {
      updatedCount: users.length
    };
  }

  async bulkAssignInbounds(userIds, inboundIds, options = {}) {
    const parsedUserIds = normalizePositiveIdArray(userIds, 'userIds');
    const inboundAssignments = await validateEnabledInboundAssignments(inboundIds || [], {
      requireAtLeastOne: true,
      allowAutoMyanmarDefaults: false
    });

    const normalizedInboundIds = inboundAssignments.map((assignment) => assignment.inboundId);
    const mode = String(options.mode || 'merge').trim().toLowerCase();
    if (!['merge', 'replace'].includes(mode)) {
      throw new ValidationError('mode must be either merge or replace');
    }

    const [users, inbounds, existingRelations] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: parsedUserIds } },
        select: { id: true }
      }),
      prisma.inbound.findMany({
        where: {
          id: { in: normalizedInboundIds },
          enabled: true
        },
        select: { id: true }
      }),
      prisma.userInbound.findMany({
        where: { userId: { in: parsedUserIds } },
        select: {
          userId: true,
          inboundId: true,
          enabled: true,
          priority: true
        }
      })
    ]);

    if (users.length !== parsedUserIds.length) {
      const existingUserIds = new Set(users.map((user) => user.id));
      const missing = parsedUserIds.filter((userId) => !existingUserIds.has(userId));
      throw new NotFoundError(`Users not found: ${missing.join(', ')}`);
    }

    if (inbounds.length !== normalizedInboundIds.length) {
      const existingInboundIds = new Set(inbounds.map((inbound) => inbound.id));
      const missing = normalizedInboundIds.filter((inboundId) => !existingInboundIds.has(inboundId));
      throw new NotFoundError(`Enabled inbounds not found: ${missing.join(', ')}`);
    }

    const relationsByUserId = new Map();
    for (const relation of existingRelations) {
      if (!relationsByUserId.has(relation.userId)) {
        relationsByUserId.set(relation.userId, []);
      }
      relationsByUserId.get(relation.userId).push(relation);
    }

    await prisma.$transaction(async (tx) => {
      for (const userId of parsedUserIds) {
        const userRelations = relationsByUserId.get(userId) || [];

        if (mode === 'replace') {
          await tx.userInbound.deleteMany({
            where: { userId }
          });

          await tx.userInbound.createMany({
            data: inboundAssignments.map((assignment, index) => ({
              userId,
              inboundId: assignment.inboundId,
              enabled: assignment.enabled,
              priority: normalizePriority(assignment.priority, 100 + index)
            }))
          });

          continue;
        }

        const assignedInboundIds = new Set(userRelations.map((relation) => relation.inboundId));
        let nextPriority = Math.max(
          100,
          ...userRelations.map((relation) => normalizePriority(relation.priority, 100))
        ) + 1;

        const toCreate = inboundAssignments
          .filter((assignment) => !assignedInboundIds.has(assignment.inboundId))
          .map((assignment) => ({
            userId,
            inboundId: assignment.inboundId,
            enabled: assignment.enabled,
            priority: nextPriority++
          }));

        if (toCreate.length > 0) {
          await tx.userInbound.createMany({
            data: toCreate,
            skipDuplicates: true
          });
        }
      }
    });

    await reloadXrayIfEnabled('bulkAssignInbounds');

    return {
      updatedCount: parsedUserIds.length,
      mode: mode.toUpperCase(),
      userIds: parsedUserIds,
      inboundIds: normalizedInboundIds
    };
  }

  async getUserActivity(
    id,
    {
      hours = 24,
      eventLimit = 300,
      ipChurnThreshold = 4,
      reconnectThreshold = 15,
      reconnectWindowMinutes = 10,
      trafficSpikeFactor = 3,
      trafficSpikeMinBytes = String(500 * 1024 * 1024) // 500 MB
    } = {}
  ) {
    const userId = parseId(id);

    const safeHours = parseBoundedInt(hours, { min: 1, max: 720, fallback: 24 });
    const safeEventLimit = parseBoundedInt(eventLimit, { min: 50, max: 1000, fallback: 300 });
    const safeIpChurnThreshold = parseBoundedInt(ipChurnThreshold, { min: 2, max: 50, fallback: 4 });
    const safeReconnectThreshold = parseBoundedInt(reconnectThreshold, { min: 3, max: 200, fallback: 15 });
    const safeReconnectWindowMinutes = parseBoundedInt(reconnectWindowMinutes, { min: 1, max: 120, fallback: 10 });
    const safeTrafficSpikeFactor = parseBoundedFloat(trafficSpikeFactor, { min: 1.1, max: 20, fallback: 3 });
    const safeTrafficSpikeMinBytes = parseNonNegativeBigInt(trafficSpikeMinBytes, 0n);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        dataLimit: true,
        uploadUsed: true,
        downloadUsed: true
      }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const now = new Date();
    const since = new Date(now.getTime() - safeHours * 60 * 60 * 1000);

    const sampleLimit = Math.min(Math.max(safeEventLimit * 2, 500), 5000);

    const [trafficLogsDesc, connectionLogsDesc] = await Promise.all([
      prisma.trafficLog.findMany({
        where: {
          userId,
          timestamp: {
            gte: since
          }
        },
        orderBy: { timestamp: 'desc' },
        take: sampleLimit
      }),
      prisma.connectionLog.findMany({
        where: {
          userId,
          timestamp: {
            gte: since
          }
        },
        include: {
          inbound: {
            select: {
              id: true,
              tag: true,
              protocol: true,
              port: true
            }
          }
        },
        orderBy: { timestamp: 'desc' },
        take: sampleLimit
      })
    ]);

    const trafficLogs = [...trafficLogsDesc].reverse();
    const connectionLogs = [...connectionLogsDesc].reverse();

    const totalUpload = trafficLogs.reduce((sum, log) => sum + (log.upload || 0n), 0n);
    const totalDownload = trafficLogs.reduce((sum, log) => sum + (log.download || 0n), 0n);
    const totalTraffic = totalUpload + totalDownload;
    const uniqueIps = new Set(connectionLogs.map((entry) => entry.clientIp).filter(Boolean));

    const alerts = [];

    if (uniqueIps.size > safeIpChurnThreshold) {
      const severity = uniqueIps.size > safeIpChurnThreshold * 2 ? 'high' : 'medium';
      alerts.push({
        id: `ip-churn-${now.getTime()}`,
        type: 'IP_CHURN',
        severity,
        message: `Suspicious IP churn detected: ${uniqueIps.size} unique IPs in last ${safeHours}h`,
        timestamp: now.toISOString(),
        details: {
          uniqueIpCount: uniqueIps.size,
          threshold: safeIpChurnThreshold,
          ipAddresses: Array.from(uniqueIps).slice(0, 20)
        }
      });
    }

    const reconnectSince = new Date(now.getTime() - safeReconnectWindowMinutes * 60 * 1000);
    const recentConnects = connectionLogs.filter(
      (entry) => entry.action === 'connect' && entry.timestamp >= reconnectSince
    );
    const recentUniqueIps = new Set(recentConnects.map((entry) => entry.clientIp).filter(Boolean));

    if (recentConnects.length >= safeReconnectThreshold) {
      alerts.push({
        id: `rapid-reconnect-${now.getTime()}`,
        type: 'RAPID_RECONNECT',
        severity: recentConnects.length >= safeReconnectThreshold * 2 ? 'critical' : 'high',
        message: `Rapid reconnect pattern: ${recentConnects.length} connects in ${safeReconnectWindowMinutes} minutes`,
        timestamp: now.toISOString(),
        details: {
          connectCount: recentConnects.length,
          uniqueIps: recentUniqueIps.size,
          threshold: safeReconnectThreshold,
          windowMinutes: safeReconnectWindowMinutes
        }
      });
    }

    const hourlyBuckets = new Map();
    for (const log of trafficLogs) {
      const keyDate = new Date(log.timestamp);
      keyDate.setMinutes(0, 0, 0);
      const key = keyDate.toISOString();
      const bytes = (log.upload || 0n) + (log.download || 0n);
      hourlyBuckets.set(key, (hourlyBuckets.get(key) || 0n) + bytes);
    }

    const hourlySeries = Array.from(hourlyBuckets.entries())
      .map(([timestamp, bytes]) => ({ timestamp, bytes }))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (hourlySeries.length >= 3) {
      const latest = hourlySeries[hourlySeries.length - 1];
      const baselineItems = hourlySeries.slice(0, -1);
      const baselineSum = baselineItems.reduce((sum, item) => sum + item.bytes, 0n);
      const baselineAverage = baselineItems.length > 0
        ? Number(baselineSum) / baselineItems.length
        : 0;
      const baselineAverageBytes = Number.isFinite(baselineAverage) && baselineAverage >= 0
        ? BigInt(Math.floor(baselineAverage))
        : 0n;

      const latestBytes = Number(latest.bytes);
      const ratio = baselineAverage > 0 ? latestBytes / baselineAverage : 0;

      if (
        latest.bytes >= safeTrafficSpikeMinBytes &&
        baselineAverage > 0 &&
        ratio >= safeTrafficSpikeFactor
      ) {
        alerts.push({
          id: `traffic-spike-${now.getTime()}`,
          type: 'TRAFFIC_SPIKE',
          severity: ratio >= safeTrafficSpikeFactor * 2 ? 'critical' : 'high',
          message: `Traffic spike: last hour is ${ratio.toFixed(1)}x baseline`,
          timestamp: latest.timestamp,
          details: {
            latestBytes: latest.bytes,
            baselineAverageBytes,
            spikeFactor: ratio,
            thresholdFactor: safeTrafficSpikeFactor,
            minBytes: safeTrafficSpikeMinBytes
          }
        });
      }
    }

    const trafficEvents = trafficLogs.map((log) => ({
      id: `traffic-${log.id}`,
      timestamp: log.timestamp.toISOString(),
      type: 'traffic',
      upload: log.upload,
      download: log.download,
      total: (log.upload || 0n) + (log.download || 0n)
    }));

    const connectionEvents = connectionLogs.map((log) => ({
      id: `connection-${log.id}`,
      timestamp: log.timestamp.toISOString(),
      type: log.action === 'disconnect' ? 'disconnect' : 'connect',
      action: log.action,
      ip: log.clientIp,
      inboundId: log.inboundId,
      inboundTag: log.inbound?.tag || null,
      inboundProtocol: log.inbound?.protocol || null,
      inboundPort: log.inbound?.port || null
    }));

    const alertEvents = alerts.map((alert) => ({
      id: `alert-${alert.id}`,
      timestamp: alert.timestamp,
      type: 'alert',
      alertType: alert.type,
      severity: alert.severity,
      message: alert.message,
      details: alert.details
    }));

    const timeline = [...trafficEvents, ...connectionEvents, ...alertEvents]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, safeEventLimit);

    const alertScore = alerts.reduce((score, alert) => {
      const weights = {
        low: 1,
        medium: 2,
        high: 3,
        critical: 4
      };
      return score + (weights[alert.severity] || 1);
    }, 0);

    return {
      user: {
        id: user.id,
        email: user.email,
        status: user.status
      },
      window: {
        hours: safeHours,
        since: since.toISOString(),
        until: now.toISOString()
      },
      summary: {
        trafficUpload: totalUpload,
        trafficDownload: totalDownload,
        trafficTotal: totalTraffic,
        connectionEvents: connectionLogs.length,
        uniqueIpCount: uniqueIps.size,
        sampledTrafficLogs: trafficLogs.length,
        sampledConnectionLogs: connectionLogs.length,
        alertCount: alerts.length,
        anomalyScore: alertScore
      },
      rules: {
        ipChurnThreshold: safeIpChurnThreshold,
        reconnectThreshold: safeReconnectThreshold,
        reconnectWindowMinutes: safeReconnectWindowMinutes,
        trafficSpikeFactor: safeTrafficSpikeFactor,
        trafficSpikeMinBytes: safeTrafficSpikeMinBytes,
        eventLimit: safeEventLimit
      },
      alerts,
      hourlyTraffic: hourlySeries,
      timeline
    };
  }

  async bulkDelete(userIds) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new ValidationError('userIds must be a non-empty array');
    }

    const ids = userIds.map((id) => parseId(id));

    const result = await prisma.user.deleteMany({
      where: { id: { in: ids } }
    });

    await reloadXrayIfEnabled('bulkDelete');

    return { deletedCount: result.count };
  }

  async bulkResetTraffic(userIds) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new ValidationError('userIds must be a non-empty array');
    }

    const ids = userIds.map((id) => parseId(id));

    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { uuid: true, email: true }
    });

    await prisma.user.updateMany({
      where: { id: { in: ids } },
      data: {
        uploadUsed: 0n,
        downloadUsed: 0n
      }
    });

    for (const user of users) {
      await xrayStatsCollector.resetUserStats(user.email || user.uuid);
    }

    return { updatedCount: users.length };
  }

  async bulkExtendExpiry(userIds, days) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new ValidationError('userIds must be a non-empty array');
    }

    const ids = userIds.map((id) => parseId(id));
    const parsedDays = parsePositiveNumber(days, 0);

    if (parsedDays <= 0) {
      throw new ValidationError('days must be a positive number');
    }

    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, expireDate: true }
    });

    const updates = users.map((user) => {
      const newExpireDate = new Date(user.expireDate);
      newExpireDate.setDate(newExpireDate.getDate() + parsedDays);
      return prisma.user.update({
        where: { id: user.id },
        data: { expireDate: newExpireDate }
      });
    });

    await Promise.all(updates);

    return { updatedCount: users.length };
  }

  async bulkUpdateStatus(userIds, status) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new ValidationError('userIds must be a non-empty array');
    }

    const validStatuses = ['ACTIVE', 'EXPIRED', 'DISABLED', 'LIMITED'];
    if (!validStatuses.includes(status)) {
      throw new ValidationError('status must be one of: ACTIVE, EXPIRED, DISABLED, LIMITED');
    }

    const ids = userIds.map((id) => parseId(id));

    const result = await prisma.user.updateMany({
      where: { id: { in: ids } },
      data: { status }
    });

    await reloadXrayIfEnabled('bulkUpdateStatus');

    return { updatedCount: result.count };
  }

  async bulkCreateUsers({
    prefix,
    domain,
    count,
    startIndex = 1,
    padding = 0,
    dataLimit,
    expiryDays,
    inboundIds,
    note,
    ipLimit,
    deviceLimit,
    status
  }) {
    const safePrefix = String(prefix || '').trim();
    const safeDomain = normalizeBulkDomain(domain);
    const safeCount = Number.parseInt(count, 10);
    const safeStart = Number.parseInt(startIndex, 10);
    const safePadding = Number.parseInt(padding, 10);
    const safeStatus = status || 'ACTIVE';
    const safeIpLimit = ipLimit === undefined ? 0 : Number.parseInt(ipLimit, 10);
    const safeDeviceLimit = deviceLimit === undefined ? 0 : Number.parseInt(deviceLimit, 10);
    const parsedDays = parsePositiveNumber(expiryDays, 30);

    if (!safePrefix) {
      throw new ValidationError('prefix is required');
    }
    if (!safeDomain) {
      throw new ValidationError('domain is required');
    }
    if (!Number.isInteger(safeCount) || safeCount < 1 || safeCount > 200) {
      throw new ValidationError('count must be between 1 and 200');
    }
    if (!Number.isInteger(safeStart) || safeStart < 1) {
      throw new ValidationError('startIndex must be a positive integer');
    }
    if (!Number.isInteger(safePadding) || safePadding < 0 || safePadding > 8) {
      throw new ValidationError('padding must be between 0 and 8');
    }
    if (parsedDays <= 0) {
      throw new ValidationError('expiryDays must be a positive number');
    }
    if (!Number.isInteger(safeIpLimit) || safeIpLimit < 0) {
      throw new ValidationError('ipLimit must be 0 or greater');
    }
    if (!Number.isInteger(safeDeviceLimit) || safeDeviceLimit < 0) {
      throw new ValidationError('deviceLimit must be 0 or greater');
    }
    const inboundAssignments = await validateEnabledInboundAssignments(inboundIds, {
      requireAtLeastOne: true,
      allowAutoMyanmarDefaults: true
    });

    const validStatuses = ['ACTIVE', 'EXPIRED', 'DISABLED', 'LIMITED'];
    if (!validStatuses.includes(safeStatus)) {
      throw new ValidationError('status is invalid');
    }

    const generatedEmails = Array.from({ length: safeCount }, (_, offset) =>
      buildBulkEmail(safePrefix, safeDomain, safeStart + offset, safePadding)
    );

    const duplicateInBatch = new Set();
    const seenEmails = new Set();
    for (const email of generatedEmails) {
      if (seenEmails.has(email)) {
        duplicateInBatch.add(email);
      }
      seenEmails.add(email);
    }

    const existingUsers = await prisma.user.findMany({
      where: { email: { in: generatedEmails } },
      select: { email: true }
    });
    const existingEmails = new Set(existingUsers.map((entry) => entry.email));

    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + parsedDays);
    const limitBytes = gbToBytes(dataLimit);

    const createdUsers = [];
    const failed = [];

    for (const email of generatedEmails) {
      if (duplicateInBatch.has(email)) {
        failed.push({ email, reason: 'Duplicate email generated in request' });
        continue;
      }
      if (existingEmails.has(email)) {
        failed.push({ email, reason: 'Email already exists' });
        continue;
      }

      try {
        const user = await prisma.user.create({
          data: {
            email,
            uuid: cryptoService.generateUUID(),
            password: cryptoService.generatePassword(),
            subscriptionToken: cryptoService.generateSubscriptionToken(),
            dataLimit: limitBytes,
            expireDate,
            note,
            ipLimit: safeIpLimit,
            deviceLimit: safeDeviceLimit,
            status: safeStatus,
            inbounds: {
              create: inboundAssignments.map((assignment) => ({
                inboundId: assignment.inboundId,
                enabled: assignment.enabled,
                priority: assignment.priority
              }))
            }
          },
          select: {
            id: true,
            email: true,
            uuid: true,
            password: true,
            subscriptionToken: true,
            expireDate: true,
            status: true
          }
        });

        createdUsers.push(user);
      } catch (error) {
        failed.push({
          email,
          reason: error?.message || 'Failed to create user'
        });
      }
    }

    if (createdUsers.length > 0) {
      await reloadXrayIfEnabled('bulkCreateUsers');
    }

    return {
      requestedCount: safeCount,
      createdCount: createdUsers.length,
      failedCount: failed.length,
      users: createdUsers,
      failed
    };
  }
}

module.exports = new UserService();
