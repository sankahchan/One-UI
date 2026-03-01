import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createMieruUser,
  deleteMieruUser,
  getMieruOnlineSnapshot,
  getMieruLogs,
  getMieruProfile,
  getMieruPolicy,
  getMieruReleaseIntel,
  getMieruStatus,
  getMieruUserExport,
  getMieruUserSubscriptionUrl,
  listMieruUsers,
  restartMieru,
  syncMieruUsers,
  updateMieru,
  updateMieruProfile,
  updateMieruUser,
  type MieruCustomUserDeleteResult,
  type MieruCustomUserResult,
  type MieruQuota,
  type MieruLogs,
  type MieruOnlineSnapshot,
  type MieruProfile,
  type MieruPolicy,
  type MieruReleaseIntel,
  type MieruRestartResult,
  type MieruSyncResult,
  type MieruStatus,
  type MieruUpdateResult,
  type MieruUserExportResult,
  type MieruUserSubscriptionUrlResult,
  type MieruUsersResult
} from '../api/mieru';

export const useMieruPolicy = () => {
  return useQuery<MieruPolicy>({
    queryKey: ['mieru-policy'],
    queryFn: getMieruPolicy,
    refetchInterval: 30_000,
    staleTime: 10_000
  });
};

export const useMieruStatus = () => {
  return useQuery<MieruStatus>({
    queryKey: ['mieru-status'],
    queryFn: getMieruStatus,
    refetchInterval: 15_000,
    staleTime: 5_000
  });
};

export const useMieruReleaseIntel = (enabled = true) => {
  return useQuery<MieruReleaseIntel>({
    queryKey: ['mieru-release-intel'],
    queryFn: () => getMieruReleaseIntel(false),
    enabled,
    staleTime: 5 * 60 * 1000
  });
};

export const useMieruLogs = (lines = 120, enabled = true) => {
  return useQuery<MieruLogs>({
    queryKey: ['mieru-logs', lines],
    queryFn: () => getMieruLogs(lines),
    enabled,
    staleTime: 3_000
  });
};

export const useRestartMieru = () => {
  const queryClient = useQueryClient();

  return useMutation<MieruRestartResult>({
    mutationFn: restartMieru,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mieru-status'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-logs'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-policy'] });
    }
  });
};

export const useUpdateMieru = () => {
  const queryClient = useQueryClient();

  return useMutation<MieruUpdateResult, Error, string | undefined>({
    mutationFn: (version) => updateMieru(version),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mieru-status'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-logs'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-policy'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-release-intel'] });
    }
  });
};

export const useSyncMieruUsers = () => {
  const queryClient = useQueryClient();

  return useMutation<MieruSyncResult, Error, string | undefined>({
    mutationFn: (reason) => syncMieruUsers(reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mieru-status'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-logs'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-policy'] });
    }
  });
};

export const useMieruProfile = () => {
  return useQuery<MieruProfile>({
    queryKey: ['mieru-profile'],
    queryFn: getMieruProfile,
    staleTime: 10_000
  });
};

export const useMieruUsers = (includeOnline = true) => {
  return useQuery<MieruUsersResult>({
    queryKey: ['mieru-users', includeOnline],
    queryFn: () => listMieruUsers(includeOnline),
    refetchInterval: includeOnline ? 15_000 : false,
    staleTime: 5_000
  });
};

export const useMieruOnlineSnapshot = (enabled = true) => {
  return useQuery<MieruOnlineSnapshot>({
    queryKey: ['mieru-online'],
    queryFn: getMieruOnlineSnapshot,
    enabled,
    refetchInterval: enabled ? 15_000 : false,
    staleTime: 5_000
  });
};

export const useUpdateMieruProfile = () => {
  const queryClient = useQueryClient();

  return useMutation<MieruProfile, Error, Partial<MieruProfile>>({
    mutationFn: updateMieruProfile,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mieru-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-users'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-online'] });
    }
  });
};

export const useCreateMieruUser = () => {
  const queryClient = useQueryClient();

  return useMutation<MieruCustomUserResult, Error, { username: string; password: string; enabled?: boolean; quotas?: MieruQuota[] }>({
    mutationFn: createMieruUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mieru-users'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-online'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-status'] });
    }
  });
};

export const useUpdateMieruUser = () => {
  const queryClient = useQueryClient();

  return useMutation<
    MieruCustomUserResult,
    Error,
    { username: string; payload: { username?: string; password?: string; enabled?: boolean; quotas?: MieruQuota[] } }
  >({
    mutationFn: ({ username, payload }) => updateMieruUser(username, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mieru-users'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-online'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-status'] });
    }
  });
};

export const useDeleteMieruUser = () => {
  const queryClient = useQueryClient();

  return useMutation<MieruCustomUserDeleteResult, Error, string>({
    mutationFn: deleteMieruUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mieru-users'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-online'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-status'] });
    }
  });
};

export const useMieruUserExport = () => {
  return useMutation<MieruUserExportResult, Error, string>({
    mutationFn: getMieruUserExport
  });
};

export const useMieruUserSubscriptionUrl = () => {
  return useMutation<MieruUserSubscriptionUrlResult, Error, string>({
    mutationFn: getMieruUserSubscriptionUrl
  });
};
