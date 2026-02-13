import apiClient from './client';
import type {
  ApiResponse,
  Group,
  GroupPolicyRollout,
  GroupPolicySchedule,
  GroupPolicyTemplate,
  UserEffectiveInboundsPayload,
  UserEffectivePolicyPayload
} from '../types';

export interface GroupPayload {
  name: string;
  remark?: string;
  isDisabled?: boolean;
  dataLimit?: number | null;
  expiryDays?: number | null;
  ipLimit?: number | null;
  status?: 'ACTIVE' | 'LIMITED' | 'EXPIRED' | 'DISABLED' | null;
  trafficResetPeriod?: 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | null;
  trafficResetDay?: number | null;
  userIds?: number[];
  inboundIds?: number[];
}

export interface GroupTemplatePayload {
  name: string;
  description?: string | null;
  isDefault?: boolean;
  dataLimit?: number | null;
  expiryDays?: number | null;
  ipLimit?: number | null;
  status?: 'ACTIVE' | 'LIMITED' | 'EXPIRED' | 'DISABLED' | null;
  trafficResetPeriod?: 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | null;
  trafficResetDay?: number | null;
}

export interface GroupSchedulePayload {
  name: string;
  groupId: number;
  templateId?: number | null;
  cronExpression: string;
  timezone?: string;
  enabled?: boolean;
  dryRun?: boolean;
  targetUserIds?: number[];
}

export interface GroupListParams {
  page?: number;
  limit?: number;
  search?: string;
  includeDisabled?: boolean;
}

export interface GroupTemplateListParams {
  page?: number;
  limit?: number;
  search?: string;
}

export interface GroupScheduleListParams {
  page?: number;
  limit?: number;
  search?: string;
  groupId?: number;
  enabled?: boolean;
}

export interface GroupRolloutListParams {
  page?: number;
  limit?: number;
  groupId?: number;
  scheduleId?: number;
  status?: 'SUCCESS' | 'FAILED' | 'DRY_RUN';
  source?: 'MANUAL' | 'SCHEDULED';
}

export const groupsApi = {
  list: async (params: GroupListParams = {}): Promise<ApiResponse<Group[]>> => {
    return apiClient.get('/groups', { params });
  },

  getById: async (id: number): Promise<ApiResponse<Group>> => {
    return apiClient.get(`/groups/${id}`);
  },

  create: async (payload: GroupPayload): Promise<ApiResponse<Group>> => {
    return apiClient.post('/groups', payload);
  },

  update: async (id: number, payload: Partial<GroupPayload>): Promise<ApiResponse<Group>> => {
    return apiClient.put(`/groups/${id}`, payload);
  },

  delete: async (id: number): Promise<ApiResponse<{ id: number }>> => {
    return apiClient.delete(`/groups/${id}`);
  },

  addUsers: async (id: number, userIds: number[]): Promise<ApiResponse<Group>> => {
    return apiClient.post(`/groups/${id}/users/add`, { userIds });
  },

  removeUsers: async (id: number, userIds: number[]): Promise<ApiResponse<Group>> => {
    return apiClient.post(`/groups/${id}/users/remove`, { userIds });
  },

  moveUsers: async (id: number, userIds: number[]): Promise<ApiResponse<Group>> => {
    return apiClient.post(`/groups/${id}/users/move`, { userIds });
  },

  setInbounds: async (id: number, inboundIds: number[]): Promise<ApiResponse<Group>> => {
    return apiClient.put(`/groups/${id}/inbounds`, { inboundIds });
  },

  applyPolicy: async (
    id: number,
    payload: { dryRun?: boolean; userIds?: number[] } = {}
  ): Promise<ApiResponse<any>> => {
    return apiClient.post(`/groups/${id}/policy/apply`, payload);
  },

  listTemplates: async (params: GroupTemplateListParams = {}): Promise<ApiResponse<GroupPolicyTemplate[]>> => {
    return apiClient.get('/groups/templates', { params });
  },

  getTemplateById: async (templateId: number): Promise<ApiResponse<GroupPolicyTemplate>> => {
    return apiClient.get(`/groups/templates/${templateId}`);
  },

  createTemplate: async (payload: GroupTemplatePayload): Promise<ApiResponse<GroupPolicyTemplate>> => {
    return apiClient.post('/groups/templates', payload);
  },

  updateTemplate: async (
    templateId: number,
    payload: Partial<GroupTemplatePayload>
  ): Promise<ApiResponse<GroupPolicyTemplate>> => {
    return apiClient.put(`/groups/templates/${templateId}`, payload);
  },

  deleteTemplate: async (templateId: number): Promise<ApiResponse<{ id: number }>> => {
    return apiClient.delete(`/groups/templates/${templateId}`);
  },

  applyTemplateToGroup: async (
    groupId: number,
    payload: { templateId: number; applyNow?: boolean; dryRun?: boolean; userIds?: number[] }
  ): Promise<ApiResponse<{ group: Group; applyResult?: any }>> => {
    return apiClient.post(`/groups/${groupId}/policy/template`, payload);
  },

  listSchedules: async (params: GroupScheduleListParams = {}): Promise<ApiResponse<GroupPolicySchedule[]>> => {
    return apiClient.get('/groups/policy-schedules', { params });
  },

  getScheduleById: async (scheduleId: number): Promise<ApiResponse<GroupPolicySchedule>> => {
    return apiClient.get(`/groups/policy-schedules/${scheduleId}`);
  },

  createSchedule: async (payload: GroupSchedulePayload): Promise<ApiResponse<GroupPolicySchedule>> => {
    return apiClient.post('/groups/policy-schedules', payload);
  },

  updateSchedule: async (
    scheduleId: number,
    payload: Partial<GroupSchedulePayload>
  ): Promise<ApiResponse<GroupPolicySchedule>> => {
    return apiClient.put(`/groups/policy-schedules/${scheduleId}`, payload);
  },

  deleteSchedule: async (scheduleId: number): Promise<ApiResponse<{ id: number }>> => {
    return apiClient.delete(`/groups/policy-schedules/${scheduleId}`);
  },

  runSchedule: async (scheduleId: number): Promise<ApiResponse<any>> => {
    return apiClient.post(`/groups/policy-schedules/${scheduleId}/run`);
  },

  listRollouts: async (params: GroupRolloutListParams = {}): Promise<ApiResponse<GroupPolicyRollout[]>> => {
    return apiClient.get('/groups/policy-rollouts', { params });
  },

  getUserEffectiveInbounds: async (userId: number): Promise<ApiResponse<UserEffectiveInboundsPayload>> => {
    return apiClient.get(`/users/${userId}/effective-inbounds`);
  },

  getUserEffectivePolicy: async (userId: number): Promise<ApiResponse<UserEffectivePolicyPayload>> => {
    return apiClient.get(`/users/${userId}/effective-policy`);
  }
};
