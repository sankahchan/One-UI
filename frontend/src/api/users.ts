import apiClient from './client';
import type {
  User,
  ApiResponse,
  UserStatus,
  SubscriptionInfo,
  SubscriptionLinksData,
  UserSessionSnapshotResponse,
  UserDeviceSessionResponse,
  UserActivityPayload,
  UserActivityQueryParams
} from '../types';

interface CreateUserData {
  email: string;
  dataLimit: number;
  expiryDays: number;
  inboundIds: number[];
  note?: string;
  ipLimit?: number;
  deviceLimit?: number;
}

interface UpdateUserData {
  email?: string;
  dataLimit?: number;
  expiryDays?: number;
  inboundIds?: number[];
  note?: string;
  status?: string;
  ipLimit?: number;
  deviceLimit?: number;
}

interface GetUsersParams {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}

export interface RotateUserKeysPayload {
  rotateUuid?: boolean;
  rotatePassword?: boolean;
  rotateSubscriptionToken?: boolean;
  reactivate?: boolean;
  resetTraffic?: boolean;
}

export interface RevokeUserKeysPayload {
  disableUser?: boolean;
  disableInbounds?: boolean;
  revokeSubscription?: boolean;
  rotateCredentials?: boolean;
}

export interface UserInboundPriorityAssignment {
  inboundId: number;
  priority: number;
  enabled?: boolean;
}

export interface BulkCreateUsersData {
  prefix: string;
  domain: string;
  count: number;
  startIndex?: number;
  padding?: number;
  dataLimit: number;
  expiryDays: number;
  inboundIds: number[];
  note?: string;
  ipLimit?: number;
  deviceLimit?: number;
  status?: string;
}

export interface BulkCreateUsersResult {
  requestedCount: number;
  createdCount: number;
  failedCount: number;
  users: Array<{
    id: number;
    email: string;
    uuid: string;
    password: string;
    subscriptionToken: string;
    expireDate: string;
    status: string;
  }>;
  failed: Array<{
    email: string;
    reason: string;
  }>;
}

export interface BulkAssignInboundsPayload {
  userIds: number[];
  inboundIds: number[];
  mode?: 'merge' | 'replace';
}

export interface UserInboundPatternPreviewEntry {
  inboundId: number;
  key: string;
  protocol: string;
  network: string;
  security: string;
  fromPriority: number;
  toPriority: number;
  matched: boolean;
}

export interface UserInboundPatternPreviewData {
  userId: number;
  email: string;
  pattern: string;
  totalKeys: number;
  matchedKeys: number;
  changedKeys: number;
  currentTop3: UserInboundPatternPreviewEntry[];
  newTop3: UserInboundPatternPreviewEntry[];
  assignments: UserInboundPriorityAssignment[];
  preview: UserInboundPatternPreviewEntry[];
  dryRun?: boolean;
  applied?: boolean;
  updatedCount?: number;
}

export interface BulkUserInboundPatternPayload {
  userIds: number[];
  pattern?: 'myanmar';
  dryRun?: boolean;
}

export interface BulkUserInboundPatternResult {
  pattern: string;
  dryRun: boolean;
  summary: {
    targetUsers: number;
    matchedUsers: number;
    wouldUpdateUsers: number;
    updatedUsers: number;
    unchangedUsers: number;
    totalKeys: number;
    changedKeys: number;
  };
  preview: Array<{
    userId: number;
    email: string;
    totalKeys: number;
    matchedKeys: number;
    changedKeys: number;
    currentTop3: UserInboundPatternPreviewEntry[];
    newTop3: UserInboundPatternPreviewEntry[];
  }>;
  previewTruncated: boolean;
}

export const usersApi = {
  getUsers: async (params: GetUsersParams = {}): Promise<ApiResponse<User[]>> => {
    return apiClient.get('/users', { params });
  },

  getUserById: async (id: number): Promise<ApiResponse<User>> => {
    return apiClient.get(`/users/${id}`);
  },

  getUserSessions: async (
    userIds: number[] = [],
    options: { includeOffline?: boolean; limit?: number } = {}
  ): Promise<ApiResponse<UserSessionSnapshotResponse>> => {
    return apiClient.get('/users/sessions', {
      params: {
        userIds: userIds.join(','),
        includeOffline: options.includeOffline ?? true,
        limit: options.limit
      }
    });
  },

  getUserSession: async (id: number): Promise<ApiResponse<any>> => {
    return apiClient.get(`/users/${id}/session`);
  },

  getUserDevices: async (id: number, windowMinutes = 60): Promise<ApiResponse<UserDeviceSessionResponse>> => {
    return apiClient.get(`/users/${id}/devices`, {
      params: { windowMinutes }
    });
  },

  revokeUserDevice: async (id: number, fingerprint: string): Promise<ApiResponse<{ released: boolean }>> => {
    return apiClient.delete(`/users/${id}/devices/${encodeURIComponent(fingerprint)}`);
  },

  disconnectUserSessions: async (
    id: number
  ): Promise<ApiResponse<{ userId: number; disconnectedDevices: number; disconnectedIps: number; disconnectLogsWritten: number }>> => {
    return apiClient.post(`/users/${id}/sessions/disconnect`);
  },

  createUser: async (data: CreateUserData): Promise<ApiResponse<User>> => {
    return apiClient.post('/users', data);
  },

  bulkCreateUsers: async (data: BulkCreateUsersData): Promise<ApiResponse<BulkCreateUsersResult>> => {
    return apiClient.post('/users/bulk/create', data);
  },

  updateUser: async (id: number, data: UpdateUserData): Promise<ApiResponse<User>> => {
    return apiClient.put(`/users/${id}`, data);
  },

  deleteUser: async (id: number): Promise<ApiResponse<void>> => {
    return apiClient.delete(`/users/${id}`);
  },

  resetTraffic: async (id: number): Promise<ApiResponse<User>> => {
    return apiClient.post(`/users/${id}/reset-traffic`);
  },

  rotateKeys: async (id: number, data: RotateUserKeysPayload = {}): Promise<ApiResponse<User>> => {
    return apiClient.post(`/users/${id}/keys/rotate`, data);
  },

  revokeKeys: async (id: number, data: RevokeUserKeysPayload = {}): Promise<ApiResponse<User>> => {
    return apiClient.post(`/users/${id}/keys/revoke`, data);
  },

  regenerateSubscriptionToken: async (
    id: number
  ): Promise<ApiResponse<{ id: number; email: string; subscriptionToken: string }>> => {
    return apiClient.post(`/users/${id}/subscription/regenerate`);
  },

  extendExpiry: async (id: number, days: number): Promise<ApiResponse<User>> => {
    return apiClient.post(`/users/${id}/extend-expiry`, { days });
  },

  toggleUserInbound: async (id: number, inboundId: number, enabled?: boolean): Promise<ApiResponse<any>> => {
    return apiClient.post(`/users/${id}/inbounds/${inboundId}/toggle`, enabled === undefined ? {} : { enabled });
  },

  updateUserInboundPriority: async (
    id: number,
    inboundId: number,
    priority: number
  ): Promise<ApiResponse<any>> => {
    return apiClient.patch(`/users/${id}/inbounds/${inboundId}/priority`, { priority });
  },

  reorderUserInbounds: async (
    id: number,
    assignments: UserInboundPriorityAssignment[]
  ): Promise<ApiResponse<any>> => {
    return apiClient.post(`/users/${id}/inbounds/reorder`, { assignments });
  },

  previewUserInboundPatternReorder: async (
    id: number,
    pattern: 'myanmar' = 'myanmar'
  ): Promise<ApiResponse<UserInboundPatternPreviewData>> => {
    return apiClient.post(`/users/${id}/inbounds/reorder-pattern/preview`, { pattern });
  },

  reorderUserInboundsByPattern: async (
    id: number,
    payload: { pattern?: 'myanmar'; dryRun?: boolean } = {}
  ): Promise<ApiResponse<UserInboundPatternPreviewData>> => {
    return apiClient.post(`/users/${id}/inbounds/reorder-pattern`, payload);
  },

  bulkReorderUserInboundsByPattern: async (
    payload: BulkUserInboundPatternPayload
  ): Promise<ApiResponse<BulkUserInboundPatternResult>> => {
    return apiClient.post('/users/bulk/inbounds/reorder-pattern', payload);
  },

  getSubscriptionInfo: async (id: number): Promise<ApiResponse<SubscriptionInfo>> => {
    return apiClient.get(`/users/${id}/subscription`);
  },

  getSubscriptionLinks: async (id: number): Promise<ApiResponse<SubscriptionLinksData>> => {
    return apiClient.get(`/users/${id}/subscription`);
  },

  getUserActivity: async (id: number, params: UserActivityQueryParams = {}): Promise<ApiResponse<UserActivityPayload>> => {
    return apiClient.get(`/users/${id}/activity`, { params });
  },

  bulkRotateKeys: async (
    userIds: number[],
    data: RotateUserKeysPayload = {}
  ): Promise<ApiResponse<{ updatedCount: number; users: User[] }>> => {
    return apiClient.post('/users/bulk/keys/rotate', { userIds, ...data });
  },

  bulkRevokeKeys: async (
    userIds: number[],
    data: RevokeUserKeysPayload = {}
  ): Promise<ApiResponse<{ updatedCount: number }>> => {
    return apiClient.post('/users/bulk/keys/revoke', { userIds, ...data });
  },

  bulkAssignInbounds: async (
    payload: BulkAssignInboundsPayload
  ): Promise<ApiResponse<{ updatedCount: number; mode: string; userIds: number[]; inboundIds: number[] }>> => {
    return apiClient.post('/users/bulk/assign-inbounds', payload);
  }
};

// Compatibility exports used by existing hooks/components.
export const listUsers = async (params: { page?: number; limit?: number; status?: UserStatus | ''; search?: string }) => {
  const response = await usersApi.getUsers({
    page: params.page,
    limit: params.limit,
    status: params.status || undefined,
    search: params.search
  });

  return {
    data: response.data ?? [],
    meta: response.meta ?? response.pagination
  };
};

export const getUser = async (id: number): Promise<User> => {
  const response = await usersApi.getUserById(id);
  if (!response.data) {
    throw new Error(response.message || 'User not found');
  }
  return response.data;
};

export const getUserSessions = async (
  userIds: number[],
  options: { includeOffline?: boolean; limit?: number } = {}
): Promise<UserSessionSnapshotResponse> => {
  const response = await usersApi.getUserSessions(userIds, options);
  return (
    response.data ?? {
      total: 0,
      online: 0,
      sessions: [],
      generatedAt: new Date().toISOString()
    }
  );
};

export const createUser = async (payload: CreateUserData): Promise<User> => {
  const response = await usersApi.createUser(payload);
  if (!response.data) {
    throw new Error(response.message || 'Failed to create user');
  }
  return response.data;
};

export const bulkCreateUsers = async (payload: BulkCreateUsersData): Promise<BulkCreateUsersResult> => {
  const response = await usersApi.bulkCreateUsers(payload);
  if (!response.data) {
    throw new Error(response.message || 'Failed to create users in bulk');
  }
  return response.data;
};

export const updateUser = async (id: number, payload: UpdateUserData): Promise<User> => {
  const response = await usersApi.updateUser(id, payload);
  if (!response.data) {
    throw new Error(response.message || 'Failed to update user');
  }
  return response.data;
};

export const deleteUser = async (id: number): Promise<void> => {
  await usersApi.deleteUser(id);
};

export const getSubscriptionInfo = async (id: number): Promise<SubscriptionInfo> => {
  const response = await usersApi.getSubscriptionInfo(id);
  if (!response.data) {
    throw new Error(response.message || 'Failed to load subscription info');
  }
  return response.data;
};

export const getSubscriptionLinks = async (id: number): Promise<SubscriptionLinksData> => {
  const response = await usersApi.getSubscriptionLinks(id);
  if (!response.data) {
    throw new Error(response.message || 'Failed to load subscription links');
  }
  return response.data;
};

export const getUserActivity = async (
  id: number,
  params: UserActivityQueryParams = {}
): Promise<UserActivityPayload> => {
  const response = await usersApi.getUserActivity(id, params);
  if (!response.data) {
    throw new Error(response.message || 'Failed to load user activity');
  }
  return response.data;
};

export const rotateUserKeys = async (id: number, payload: RotateUserKeysPayload = {}): Promise<User> => {
  const response = await usersApi.rotateKeys(id, payload);
  if (!response.data) {
    throw new Error(response.message || 'Failed to rotate user keys');
  }

  return response.data;
};

export const revokeUserKeys = async (id: number, payload: RevokeUserKeysPayload = {}): Promise<User> => {
  const response = await usersApi.revokeKeys(id, payload);
  if (!response.data) {
    throw new Error(response.message || 'Failed to revoke user keys');
  }

  return response.data;
};

export const regenerateSubscriptionToken = async (
  id: number
): Promise<{ id: number; email: string; subscriptionToken: string }> => {
  const response = await usersApi.regenerateSubscriptionToken(id);
  if (!response.data) {
    throw new Error(response.message || 'Failed to regenerate subscription token');
  }

  return response.data;
};

interface BulkOperationResult {
  deletedCount?: number;
  updatedCount?: number;
}

export const bulkDelete = async (userIds: number[]): Promise<BulkOperationResult> => {
  const response = await apiClient.post<ApiResponse<BulkOperationResult>>('/users/bulk/delete', { userIds });
  return response.data ?? {};
};

export const bulkResetTraffic = async (userIds: number[]): Promise<BulkOperationResult> => {
  const response = await apiClient.post<ApiResponse<BulkOperationResult>>('/users/bulk/reset-traffic', { userIds });
  return response.data ?? {};
};

export const bulkExtendExpiry = async (userIds: number[], days: number): Promise<BulkOperationResult> => {
  const response = await apiClient.post<ApiResponse<BulkOperationResult>>('/users/bulk/extend-expiry', { userIds, days });
  return response.data ?? {};
};

export const bulkUpdateStatus = async (userIds: number[], status: string): Promise<BulkOperationResult> => {
  const response = await apiClient.post<ApiResponse<BulkOperationResult>>('/users/bulk/update-status', { userIds, status });
  return response.data ?? {};
};

export const bulkRotateUserKeys = async (
  userIds: number[],
  payload: RotateUserKeysPayload = {}
): Promise<{ updatedCount: number; users: User[] }> => {
  const response = await usersApi.bulkRotateKeys(userIds, payload);
  return response.data ?? { updatedCount: 0, users: [] };
};

export const bulkRevokeUserKeys = async (
  userIds: number[],
  payload: RevokeUserKeysPayload = {}
): Promise<{ updatedCount: number }> => {
  const response = await usersApi.bulkRevokeKeys(userIds, payload);
  return response.data ?? { updatedCount: 0 };
};
