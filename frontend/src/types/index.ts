export interface User {
  id: number;
  email: string;
  uuid: string;
  password: string;
  subscriptionToken: string;
  dataLimit: number;
  uploadUsed: number;
  downloadUsed: number;
  totalUsed?: number;
  remaining?: number;
  remainingPercent?: number;
  ipLimit: number; // 0 = unlimited
  deviceLimit: number; // 0 = unlimited
  startOnFirstUse?: boolean;
  firstUsedAt?: string | null;
  expireDate: string;
  daysRemaining?: number;
  status: 'ACTIVE' | 'EXPIRED' | 'DISABLED' | 'LIMITED';
  note?: string;
  createdAt: string;
  updatedAt: string;
  inbounds?: UserInbound[];
}

export interface Inbound {
  id: number;
  port: number;
  protocol: 'VLESS' | 'VMESS' | 'TROJAN' | 'SHADOWSOCKS' | 'SOCKS' | 'HTTP' | 'DOKODEMO_DOOR' | 'WIREGUARD' | 'MTPROTO';
  tag: string;
  remark?: string;
  enabled: boolean;
  network: 'TCP' | 'WS' | 'GRPC' | 'HTTP' | 'HTTPUPGRADE' | 'XHTTP';
  security: 'NONE' | 'TLS' | 'REALITY';
  serverName?: string;
  serverAddress: string;
  wsPath?: string;
  wsHost?: string;
  xhttpMode?: string;
  grpcServiceName?: string;
  cipher?: string;
  alpn?: string;
  // REALITY fields
  realityPublicKey?: string;
  realityPrivateKey?: string;
  realityShortIds?: string[];
  realityServerNames?: string[];
  realityFingerprint?: string;
  realityDest?: string;
  realitySpiderX?: string;
  // Wireguard fields
  wgPrivateKey?: string;
  wgPublicKey?: string;
  wgAddress?: string;
  wgPeerPublicKey?: string;
  wgPeerEndpoint?: string;
  wgAllowedIPs?: string;
  wgMtu?: number;
  dokodemoTargetPort?: number;
  dokodemoNetwork?: string;
  dokodemoFollowRedirect?: boolean;
  domains?: string[];
  fallbacks?: Array<{
    dest: string;
    path?: string;
    alpn?: string[] | string;
    name?: string;
    xver?: number;
  }>;
  createdAt: string;
  updatedAt: string;
  _count?: {
    userInbounds: number;
  };
}

export interface UserInbound {
  id: number;
  userId: number;
  inboundId: number;
  enabled: boolean;
  priority?: number;
  inbound: Inbound;
}

export interface GroupUserMembership {
  id: number;
  userId: number;
  groupId: number;
  createdAt: string;
  user: Pick<User, 'id' | 'email' | 'status'>;
}

export interface GroupInboundMembership {
  id: number;
  inboundId: number;
  groupId: number;
  enabled: boolean;
  priority?: number;
  createdAt: string;
  inbound: Pick<Inbound, 'id' | 'tag' | 'protocol' | 'port' | 'enabled'>;
}

export interface Group {
  id: number;
  name: string;
  remark?: string | null;
  isDisabled: boolean;
  dataLimit?: number | string | null;
  expiryDays?: number | null;
  ipLimit?: number | null;
  status?: User['status'] | null;
  trafficResetPeriod?: 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | null;
  trafficResetDay?: number | null;
  createdAt: string;
  updatedAt: string;
  users: GroupUserMembership[];
  inbounds: GroupInboundMembership[];
  _count?: {
    users: number;
    inbounds: number;
  };
}

export interface GroupPolicyTemplate {
  id: number;
  name: string;
  description?: string | null;
  isDefault: boolean;
  dataLimit?: number | string | null;
  expiryDays?: number | null;
  ipLimit?: number | null;
  status?: User['status'] | null;
  trafficResetPeriod?: 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | null;
  trafficResetDay?: number | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    schedules: number;
    rollouts: number;
  };
}

export interface GroupPolicySchedule {
  id: number;
  name: string;
  groupId: number;
  templateId?: number | null;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  dryRun: boolean;
  targetUserIds: number[];
  lastRunAt?: string | null;
  lastStatus?: 'SUCCESS' | 'FAILED' | 'DRY_RUN' | null;
  lastError?: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
  group?: Pick<Group, 'id' | 'name' | 'isDisabled'>;
  template?: Pick<GroupPolicyTemplate, 'id' | 'name'> | null;
  _count?: {
    rollouts: number;
  };
}

export interface GroupPolicyRollout {
  id: number;
  groupId: number;
  templateId?: number | null;
  scheduleId?: number | null;
  source: 'MANUAL' | 'SCHEDULED';
  status: 'SUCCESS' | 'FAILED' | 'DRY_RUN';
  dryRun: boolean;
  initiatedBy?: string | null;
  summary?: unknown;
  errorMessage?: string | null;
  createdAt: string;
  group?: Pick<Group, 'id' | 'name'>;
  template?: Pick<GroupPolicyTemplate, 'id' | 'name'> | null;
  schedule?: Pick<GroupPolicySchedule, 'id' | 'name'> | null;
}

export interface EffectiveInboundSource {
  type: 'DIRECT' | 'GROUP';
  groupId?: number;
  groupName?: string;
}

export interface EffectiveInboundEntry {
  inboundId: number;
  inbound: Inbound;
  sources: EffectiveInboundSource[];
}

export interface UserEffectiveInboundsPayload {
  user: Pick<User, 'id' | 'email' | 'status'>;
  groups: Array<{
    id: number;
    name: string;
    isDisabled: boolean;
  }>;
  directInbounds: Array<{
    inboundId: number;
    inbound: Inbound;
  }>;
  groupInbounds: Array<{
    groupId: number;
    groupName: string;
    inboundId: number;
    inbound: Inbound;
  }>;
  effectiveInbounds: EffectiveInboundEntry[];
}

export interface UserEffectivePolicyPayload {
  user: {
    id: number;
    email: string;
  };
  directPolicy: {
    dataLimit: number | string;
    expireDate: string;
    ipLimit: number;
    status: User['status'];
    trafficResetPeriod: 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
    trafficResetDay: number;
  };
  inheritedPolicy: {
    dataLimit: number | string | null;
    expiryDays: number | null;
    expireDate: string | null;
    ipLimit: number | null;
    status: User['status'] | null;
    trafficResetPeriod: 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | null;
    trafficResetDay: number | null;
  };
  effectivePolicy: {
    dataLimit: number | string;
    expireDate: string;
    ipLimit: number;
    status: User['status'];
    trafficResetPeriod: 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
    trafficResetDay: number;
  };
  drift: {
    dataLimit: boolean;
    expireDate: boolean;
    ipLimit: boolean;
    status: boolean;
    trafficResetPeriod: boolean;
    trafficResetDay: boolean;
  };
  groups: Array<{
    id: number;
    name: string;
    policy: {
      dataLimit: number | string | null;
      expiryDays: number | null;
      ipLimit: number | null;
      status: User['status'] | null;
      trafficResetPeriod: 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | null;
      trafficResetDay: number | null;
    };
  }>;
}

export interface UserSessionInbound {
  id: number;
  tag: string;
  protocol: Inbound['protocol'];
  port: number;
}

export interface UserSessionSnapshot {
  userId: number;
  uuid: string;
  email: string;
  status: UserStatus;
  online: boolean;
  state: 'online' | 'idle' | 'offline';
  activeKeyCount?: number;
  onlineKeyCount?: number;
  lastSeenAt: string | null;
  lastPacketSeenAt?: string | null;
  lastAction: 'connect' | 'disconnect' | null;
  currentIp: string | null;
  currentInbound: UserSessionInbound | null;
  protocol: Inbound['protocol'] | string | null;
  upload: number;
  download: number;
  quality?: {
    connectSuccesses: number;
    limitRejects: number;
    reconnects: number;
    reconnectFrequencyPerHour: number;
    avgTrafficPerMinute: number;
    byProtocol: Array<{
      protocol: string;
      connectSuccesses: number;
      limitRejects: number;
      reconnects: number;
      score?: number;
      avgTrafficPerMinute?: number;
    }>;
    byProfile?: Array<{
      inboundId: number | null;
      tag: string;
      protocol: string;
      port: number;
      connectSuccesses: number;
      limitRejects: number;
      reconnects: number;
      score?: number;
      avgTrafficPerMinute?: number;
    }>;
  };
}

export interface UserSessionSnapshotResponse {
  total: number;
  online: number;
  sessions: UserSessionSnapshot[];
  generatedAt: string;
}

export interface UserDeviceSession {
  fingerprint: string;
  shortFingerprint: string;
  online: boolean;
  lastSeenAt: string;
  lastAction: 'connect' | 'disconnect' | string;
  clientIp: string | null;
  userAgent: string | null;
  inbound: UserSessionInbound | null;
  hitCount: number;
}

export interface UserDeviceSessionResponse {
  user: {
    id: number;
    email: string;
    ipLimit: number;
    deviceLimit: number;
  };
  windowMinutes: number;
  total: number;
  online: number;
  devices: UserDeviceSession[];
}

export interface TelemetrySyncStatus {
  status: 'healthy' | 'degraded' | 'stale' | 'starting' | 'stopped';
  running: boolean;
  transport: string;
  intervalMs: number;
  staleThresholdMs: number;
  lagMs: number | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  consecutiveFailures: number;
  lastUsersScanned: number;
  lastUsersUpdated: number;
  lastTrafficBytes: string;
  lastDurationMs: number;
  activeUsers: number;
  activeUserInbounds: number;
  generatedAt: string;
  fallbackAutotune?: {
    enabled: boolean;
    schedule: string;
    windowMinutes: number;
    minKeys: number;
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastErrorMessage: string | null;
    consecutiveFailures: number;
    lastSummary?: {
      targetUsers: number;
      wouldUpdateUsers: number;
      updatedUsers: number;
      unchangedUsers: number;
      totalKeys: number;
      scoredKeys: number;
      changedKeys: number;
    } | null;
  };
}

export interface UserDiagnosticCheck {
  id: string;
  label: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  details: string;
  recommendedAction?: string | null;
}

export interface UserDiagnosticsResult {
  userId: number;
  email: string;
  generatedAt: string;
  summary: {
    pass: number;
    warn: number;
    fail: number;
    total: number;
  };
  context: {
    userStatus: string;
    online: boolean;
    currentIp: string | null;
    telemetryStatus: string;
    xrayRunning: boolean;
    enabledKeys: number;
    onlineDevices: number;
    seenDevices: number;
  };
  checks: UserDiagnosticCheck[];
  recommendedActions: string[];
}

export interface SystemStats {
  users: {
    total: number;
    active: number;
    expired: number;
    disabled: number;
  };
  traffic: {
    totalUpload: number;
    totalDownload: number;
    totalTraffic: number;
  };
}

export interface LoginCredentials {
  username: string;
  password: string;
  otp?: string;
}

export interface AuthResponse {
  token: string;
  refreshToken?: string;
  requiresTwoFactorSetup?: boolean;
  admin: {
    id: number;
    username: string;
    role: string;
    email?: string;
    twoFactorEnabled?: boolean;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    [key: string]: unknown;
  };
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  error?: {
    message: string;
    code: string;
    details?: any;
  };
}

// Compatibility exports used across current frontend modules.
export type UserStatus = User['status'];
export type Protocol = Inbound['protocol'];
export type Network = Inbound['network'];
export type Security = Inbound['security'];
export type NumericLike = number | string;

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccess<T, M = unknown> {
  success: boolean;
  message: string;
  data: T;
  meta?: M;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

export type Admin = AuthResponse['admin'];
export type LoginPayload = LoginCredentials;
export type LoginResult = AuthResponse;

export interface SubscriptionInfo {
  urls: {
    v2ray: string;
    clash: string;
    singbox: string;
    wireguard?: string;
  };
  qrCodes: {
    v2ray: string;
    clash: string;
    singbox: string;
    wireguard?: string;
  };
  token: string;
}

export interface SubscriptionLink {
  inboundId: number;
  remark: string;
  protocol: string;
  network: string;
  security: string;
  url: string;
  qrCode: string;
}

export interface SubscriptionLinksData {
  urls: {
    v2ray: string;
    clash: string;
    singbox: string;
    wireguard?: string;
  };
  qrCodes: {
    v2ray: string;
    clash: string;
    singbox: string;
    wireguard?: string;
  };
  token: string;
  links: SubscriptionLink[];
  shareUrl: string;
  branding?: {
    appName?: string;
    logoUrl?: string | null;
    primaryColor?: string | null;
    accentColor?: string | null;
    profileTitle?: string | null;
    profileDescription?: string | null;
    supportUrl?: string | null;
    customFooter?: string | null;
    metadata?: unknown;
  } | null;
}

export interface UserCreatePayload {
  email: string;
  dataLimit: number;
  expiryDays: number;
  inboundIds: number[];
  note?: string;
}

export interface UserUpdatePayload {
  email?: string;
  dataLimit?: number;
  expiryDays?: number;
  inboundIds?: number[];
  note?: string;
  status?: UserStatus;
}

export interface InboundPayload {
  port: number;
  protocol: Protocol;
  tag: string;
  remark?: string;
  enabled?: boolean;
  network?: Network;
  security?: Security;
  serverName?: string;
  serverAddress: string;
  alpn?: string;
  wsPath?: string;
  wsHost?: string;
  xhttpMode?: string;
  grpcServiceName?: string;
  cipher?: string;
  domains?: string[] | string;
  fallbacks?: Array<{
    dest: string;
    path?: string;
    alpn?: string[] | string;
    name?: string;
    xver?: number;
  }> | string;
  dokodemoTargetPort?: number;
  dokodemoNetwork?: string;
  dokodemoFollowRedirect?: boolean;
}

export type UserActivityAlertSeverity = 'low' | 'medium' | 'high' | 'critical';
export type UserActivityAlertType = 'IP_CHURN' | 'RAPID_RECONNECT' | 'TRAFFIC_SPIKE';
export type UserActivityTimelineType = 'traffic' | 'connect' | 'disconnect' | 'alert';

export interface UserActivityAlert {
  id: string;
  type: UserActivityAlertType;
  severity: UserActivityAlertSeverity;
  message: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface UserActivityTimelineEvent {
  id: string;
  timestamp: string;
  type: UserActivityTimelineType;
  action?: string;
  ip?: string;
  inboundId?: number;
  inboundTag?: string | null;
  inboundProtocol?: string | null;
  inboundPort?: number | null;
  upload?: string | number;
  download?: string | number;
  total?: string | number;
  alertType?: UserActivityAlertType;
  severity?: UserActivityAlertSeverity;
  message?: string;
  details?: Record<string, unknown>;
}

export interface UserActivityHourlyPoint {
  timestamp: string;
  bytes: string | number;
}

export interface UserActivitySummary {
  trafficUpload: string;
  trafficDownload: string;
  trafficTotal: string;
  connectionEvents: number;
  uniqueIpCount: number;
  sampledTrafficLogs: number;
  sampledConnectionLogs: number;
  alertCount: number;
  anomalyScore: number;
}

export interface UserActivityRules {
  ipChurnThreshold: number;
  reconnectThreshold: number;
  reconnectWindowMinutes: number;
  trafficSpikeFactor: number;
  trafficSpikeMinBytes: string;
  eventLimit: number;
}

export interface UserActivityPayload {
  user: {
    id: number;
    email: string;
    status: UserStatus;
  };
  window: {
    hours: number;
    since: string;
    until: string;
  };
  summary: UserActivitySummary;
  rules: UserActivityRules;
  alerts: UserActivityAlert[];
  hourlyTraffic: UserActivityHourlyPoint[];
  timeline: UserActivityTimelineEvent[];
}

export interface UserActivityQueryParams {
  hours?: number;
  eventLimit?: number;
  ipChurnThreshold?: number;
  reconnectThreshold?: number;
  reconnectWindowMinutes?: number;
  trafficSpikeFactor?: number;
  trafficSpikeMinBytes?: string;
}
