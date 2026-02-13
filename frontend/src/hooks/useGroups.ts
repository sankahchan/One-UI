import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  groupsApi,
  type GroupListParams,
  type GroupPayload,
  type GroupRolloutListParams,
  type GroupScheduleListParams,
  type GroupSchedulePayload,
  type GroupTemplateListParams,
  type GroupTemplatePayload
} from '../api/groups';
import type {
  ApiResponse,
  Group,
  GroupPolicyRollout,
  GroupPolicySchedule,
  GroupPolicyTemplate,
  UserEffectiveInboundsPayload,
  UserEffectivePolicyPayload
} from '../types';

export const useGroups = (params: GroupListParams = {}) => {
  return useQuery<ApiResponse<Group[]>>({
    queryKey: ['groups', params],
    queryFn: () => groupsApi.list(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000
  });
};

export const useGroup = (id: number) => {
  return useQuery<ApiResponse<Group>>({
    queryKey: ['group', id],
    queryFn: () => groupsApi.getById(id),
    enabled: Number.isInteger(id) && id > 0,
    staleTime: 30_000
  });
};

export const useCreateGroup = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: GroupPayload) => groupsApi.create(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    }
  });
};

export const useUpdateGroup = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<GroupPayload> }) => groupsApi.update(id, payload),
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      void queryClient.invalidateQueries({ queryKey: ['group', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    }
  });
};

export const useDeleteGroup = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => groupsApi.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    }
  });
};

export const useUserEffectiveInbounds = (userId: number) => {
  return useQuery<ApiResponse<UserEffectiveInboundsPayload>>({
    queryKey: ['user-effective-inbounds', userId],
    queryFn: () => groupsApi.getUserEffectiveInbounds(userId),
    enabled: Number.isInteger(userId) && userId > 0,
    staleTime: 10_000
  });
};

export const useUserEffectivePolicy = (userId: number) => {
  return useQuery<ApiResponse<UserEffectivePolicyPayload>>({
    queryKey: ['user-effective-policy', userId],
    queryFn: () => groupsApi.getUserEffectivePolicy(userId),
    enabled: Number.isInteger(userId) && userId > 0,
    staleTime: 10_000
  });
};

export const useMoveUsersToGroup = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, userIds }: { id: number; userIds: number[] }) => groupsApi.moveUsers(id, userIds),
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      void queryClient.invalidateQueries({ queryKey: ['group', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    }
  });
};

export const useApplyGroupPolicy = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: { dryRun?: boolean; userIds?: number[] } }) =>
      groupsApi.applyPolicy(id, payload),
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      void queryClient.invalidateQueries({ queryKey: ['group', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['user-effective-policy'] });
    }
  });
};

export const useGroupPolicyTemplates = (params: GroupTemplateListParams = {}) => {
  return useQuery<ApiResponse<GroupPolicyTemplate[]>>({
    queryKey: ['group-policy-templates', params],
    queryFn: () => groupsApi.listTemplates(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000
  });
};

export const useCreateGroupPolicyTemplate = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: GroupTemplatePayload) => groupsApi.createTemplate(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['group-policy-templates'] });
    }
  });
};

export const useUpdateGroupPolicyTemplate = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ templateId, payload }: { templateId: number; payload: Partial<GroupTemplatePayload> }) =>
      groupsApi.updateTemplate(templateId, payload),
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['group-policy-templates'] });
      void queryClient.invalidateQueries({ queryKey: ['group-policy-template', variables.templateId] });
    }
  });
};

export const useDeleteGroupPolicyTemplate = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (templateId: number) => groupsApi.deleteTemplate(templateId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['group-policy-templates'] });
    }
  });
};

export const useApplyGroupPolicyTemplate = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      groupId,
      payload
    }: {
      groupId: number;
      payload: { templateId: number; applyNow?: boolean; dryRun?: boolean; userIds?: number[] };
    }) => groupsApi.applyTemplateToGroup(groupId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['group-policy-rollouts'] });
    }
  });
};

export const useGroupPolicySchedules = (params: GroupScheduleListParams = {}) => {
  return useQuery<ApiResponse<GroupPolicySchedule[]>>({
    queryKey: ['group-policy-schedules', params],
    queryFn: () => groupsApi.listSchedules(params),
    placeholderData: keepPreviousData,
    staleTime: 15_000
  });
};

export const useCreateGroupPolicySchedule = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: GroupSchedulePayload) => groupsApi.createSchedule(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['group-policy-schedules'] });
    }
  });
};

export const useUpdateGroupPolicySchedule = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ scheduleId, payload }: { scheduleId: number; payload: Partial<GroupSchedulePayload> }) =>
      groupsApi.updateSchedule(scheduleId, payload),
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['group-policy-schedules'] });
      void queryClient.invalidateQueries({ queryKey: ['group-policy-schedule', variables.scheduleId] });
    }
  });
};

export const useDeleteGroupPolicySchedule = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (scheduleId: number) => groupsApi.deleteSchedule(scheduleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['group-policy-schedules'] });
    }
  });
};

export const useRunGroupPolicySchedule = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (scheduleId: number) => groupsApi.runSchedule(scheduleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['group-policy-schedules'] });
      void queryClient.invalidateQueries({ queryKey: ['group-policy-rollouts'] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    }
  });
};

export const useGroupPolicyRollouts = (params: GroupRolloutListParams = {}) => {
  return useQuery<ApiResponse<GroupPolicyRollout[]>>({
    queryKey: ['group-policy-rollouts', params],
    queryFn: () => groupsApi.listRollouts(params),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    refetchInterval: 15_000
  });
};
