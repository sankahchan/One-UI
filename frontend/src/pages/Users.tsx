import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { Download, Plus, RefreshCw, Search, Users as UsersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { usersApi } from '../api/users';
import { groupsApi } from '../api/groups';
import { Button } from '../components/atoms/Button';
import { Card } from '../components/atoms/Card';
import { UserBulkCreateModal } from '../components/organisms/UserBulkCreateModal';
import { UserQuickEditModal } from '../components/organisms/UserQuickEditModal';
import { UserQuickQrModal } from '../components/organisms/UserQuickQrModal';
import { Input } from '../components/atoms/Input';
import { UserFormModal } from '../components/organisms/UserFormModal';
import { UserTable } from '../components/organisms/UserTable';
import { MyanmarPriorityPreviewModal } from '../components/organisms/MyanmarPriorityPreviewModal';
import { ConfirmDialog } from '../components/organisms/ConfirmDialog';
import { PromptDialog } from '../components/organisms/PromptDialog';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useGroups } from '../hooks/useGroups';
import { usePersistedFilters, useSavedViews } from '../hooks/usePersistedFilters';
import { useSmartAutoRefresh } from '../hooks/useSmartAutoRefresh';
import { useToast } from '../hooks/useToast';
import {
  useBulkDelete,
  useBulkExtendExpiry,
  useBulkRevokeUserKeys,
  useBulkResetTraffic,
  useBulkRotateUserKeys,
  useBulkUpdateStatus,
  useDeleteUser,
  useRegenerateSubscriptionToken,
  useRevokeUserKeys,
  useRotateUserKeys,
  useUserSessions,
  useUsers
} from '../hooks/useUsers';
import { useAuthStore } from '../store/authStore';
import type { Group, PaginationMeta, User, UserStatus } from '../types';
import { Skeleton } from '../components/atoms/Skeleton';
import { prefetchRoute } from '../utils/routePrefetch';

function getPagination(payload: unknown): PaginationMeta | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const candidate = (payload as { meta?: PaginationMeta; pagination?: PaginationMeta }).meta
    || (payload as { meta?: PaginationMeta; pagination?: PaginationMeta }).pagination;

  if (!candidate) {
    return undefined;
  }

  return candidate;
}

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

export function Users() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation();
  const toast = useToast();
  const admin = useAuthStore((state) => state.admin);
  const isSuperAdmin = admin?.role === 'SUPER_ADMIN';

  const usersFilters = usePersistedFilters<{
    page: number;
    search: string;
    status: UserStatus | '';
    viewMode: 'auto' | 'table' | 'cards';
  }>('one-ui/users-filters', {
    page: 1,
    search: '',
    status: '',
    viewMode: 'auto'
  });
  const { views: savedViews, saveView, deleteView } = useSavedViews<{
    search: string;
    status: UserStatus | '';
    viewMode: 'auto' | 'table' | 'cards';
  }>('one-ui/users-saved-views');

  const [selectedViewId, setSelectedViewId] = useState('');

  const page = usersFilters.value.page;
  const search = usersFilters.value.search;
  const status = usersFilters.value.status;
  const viewMode = usersFilters.value.viewMode;
  const setFilters = usersFilters.setValue;
  const setPage = useCallback((nextPage: number | ((previousPage: number) => number)) => {
    setFilters((previous) => {
      const resolvedPage = typeof nextPage === 'function'
        ? nextPage(previous.page)
        : nextPage;

      return { ...previous, page: Math.max(1, resolvedPage) };
    });
  }, [setFilters]);
  const setSearch = useCallback((nextSearch: string) => {
    setFilters((previous) => ({ ...previous, search: nextSearch }));
  }, [setFilters]);
  const setStatus = useCallback((nextStatus: UserStatus | '') => {
    setFilters((previous) => ({ ...previous, status: nextStatus }));
  }, [setFilters]);
  const setViewMode = useCallback((nextViewMode: 'auto' | 'table' | 'cards') => {
    setFilters((previous) => ({ ...previous, viewMode: nextViewMode }));
  }, [setFilters]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [quickQrUser, setQuickQrUser] = useState<User | null>(null);
  const [quickEditUser, setQuickEditUser] = useState<User | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description?: string;
    confirmLabel?: string;
    tone?: 'danger' | 'primary';
  } | null>(null);
  const [promptDialog, setPromptDialog] = useState<{
    title: string;
    description?: string;
    label?: string;
    placeholder?: string;
    defaultValue?: string;
    inputType?: 'text' | 'number';
    confirmLabel?: string;
  } | null>(null);
  const [bulkMyanmarPreviewState, setBulkMyanmarPreviewState] = useState<{
    userIds: number[];
    targetUsers: number;
    wouldUpdateUsers: number;
    unchangedUsers: number;
    changedKeys: number;
    matchedUsers: number;
    previewLines: string[];
  } | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [bulkStatus, setBulkStatus] = useState<UserStatus>('DISABLED');
  const debouncedSearch = useDebouncedValue(search, 320);
  const quickAction = searchParams.get('quick');
  const confirmResolverRef = useRef<((accepted: boolean) => void) | null>(null);
  const promptResolverRef = useRef<((value: string | null) => void) | null>(null);

  const usersQuery = useUsers({ page, limit: 50, search: debouncedSearch, status: status || undefined });
  const groupsQuery = useGroups({ page: 1, limit: 100, includeDisabled: false });
  const deleteUserMutation = useDeleteUser();
  const rotateKeysMutation = useRotateUserKeys();
  const revokeKeysMutation = useRevokeUserKeys();
  const regenerateSubscriptionMutation = useRegenerateSubscriptionToken();
  const bulkDeleteMutation = useBulkDelete();
  const bulkResetTrafficMutation = useBulkResetTraffic();
  const bulkExtendExpiryMutation = useBulkExtendExpiry();
  const bulkUpdateStatusMutation = useBulkUpdateStatus();
  const bulkRotateKeysMutation = useBulkRotateUserKeys();
  const bulkRevokeKeysMutation = useBulkRevokeUserKeys();
  const bulkMyanmarPriorityMutation = useMutation({
    mutationFn: ({ userIds, dryRun }: { userIds: number[]; dryRun?: boolean }) =>
      usersApi.bulkReorderUserInboundsByPattern({
        userIds,
        pattern: 'myanmar',
        dryRun
      })
  });
  const assignGroupMutation = useMutation({
    mutationFn: ({ groupId, userIds }: { groupId: number; userIds: number[] }) => groupsApi.addUsers(groupId, userIds),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['group', variables.groupId] }),
        queryClient.invalidateQueries({ queryKey: ['users'] })
      ]);
    }
  });
  const removeGroupUsersMutation = useMutation({
    mutationFn: ({ groupId, userIds }: { groupId: number; userIds: number[] }) => groupsApi.removeUsers(groupId, userIds),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['group', variables.groupId] }),
        queryClient.invalidateQueries({ queryKey: ['users'] })
      ]);
    }
  });
  const moveGroupUsersMutation = useMutation({
    mutationFn: ({ groupId, userIds }: { groupId: number; userIds: number[] }) => groupsApi.moveUsers(groupId, userIds),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['group', variables.groupId] }),
        queryClient.invalidateQueries({ queryKey: ['users'] })
      ]);
    }
  });
  const applyGroupPolicyMutation = useMutation({
    mutationFn: ({ groupId, payload }: { groupId: number; payload: { dryRun?: boolean; userIds?: number[] } }) =>
      groupsApi.applyPolicy(groupId, payload),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['group', variables.groupId] }),
        queryClient.invalidateQueries({ queryKey: ['users'] }),
        queryClient.invalidateQueries({ queryKey: ['user-effective-policy'] })
      ]);
    }
  });
  const quickLimitUpdateMutation = useMutation({
    mutationFn: ({ userId, payload }: { userId: number; payload: { ipLimit?: number; deviceLimit?: number } }) =>
      usersApi.updateUser(userId, payload),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['users'] }),
        queryClient.invalidateQueries({ queryKey: ['user', variables.userId] }),
        queryClient.invalidateQueries({ queryKey: ['user-devices', variables.userId, 60] })
      ]);
    }
  });

  const users = useMemo<User[]>(() => usersQuery.data?.data ?? [], [usersQuery.data]);
  const groups = useMemo<Group[]>(() => groupsQuery.data?.data ?? [], [groupsQuery.data]);
  const pagination = useMemo(() => getPagination(usersQuery.data), [usersQuery.data]);
  const pageUserIds = useMemo(() => users.map((user) => user.id), [users]);
  const userSessionsQuery = useUserSessions(pageUserIds, {
    includeOffline: true,
    refetchInterval: 5_000,
    staleTime: 5_000
  });
  const sessionsByUserId = useMemo(
    () =>
      Object.fromEntries(
        (userSessionsQuery.data?.sessions || []).map((session) => [session.userId, session])
      ),
    [userSessionsQuery.data?.sessions]
  );
  const onlineUuidSet = useMemo(
    () =>
      new Set(
        (userSessionsQuery.data?.sessions || [])
          .filter((session) => session.online)
          .map((session) => String(session.uuid || ''))
      ),
    [userSessionsQuery.data?.sessions]
  );

  const activeCount = useMemo(() => users.filter((user) => user.status === 'ACTIVE').length, [users]);
  const onlineCount = useMemo(
    () => users.filter((user) => sessionsByUserId[user.id]?.online || onlineUuidSet.has(user.uuid)).length,
    [onlineUuidSet, sessionsByUserId, users]
  );
  const limitedCount = useMemo(() => users.filter((user) => user.status === 'LIMITED').length, [users]);
  const expiredCount = useMemo(() => users.filter((user) => user.status === 'EXPIRED').length, [users]);
  const selectedUsers = useMemo(
    () => users.filter((user) => selectedUserIds.includes(user.id)),
    [users, selectedUserIds]
  );
  const canDeleteUsers = isSuperAdmin;
  const canRevokeUsers = isSuperAdmin;
  const isBulkMutating = bulkDeleteMutation.isPending
    || bulkResetTrafficMutation.isPending
    || bulkExtendExpiryMutation.isPending
    || bulkUpdateStatusMutation.isPending
    || bulkRotateKeysMutation.isPending
    || bulkRevokeKeysMutation.isPending
    || bulkMyanmarPriorityMutation.isPending
    || assignGroupMutation.isPending
    || removeGroupUsersMutation.isPending
    || moveGroupUsersMutation.isPending
    || applyGroupPolicyMutation.isPending;

  const streamStatusLabel = useMemo(() => {
    if (userSessionsQuery.streamStatus === 'connected') {
      return 'Connected';
    }
    if (userSessionsQuery.streamStatus === 'connecting') {
      return userSessionsQuery.reconnectAttempts > 0 ? `Reconnecting (${userSessionsQuery.reconnectAttempts})` : 'Connecting';
    }
    if (userSessionsQuery.streamStatus === 'error') {
      return 'Error';
    }
    return 'Idle';
  }, [userSessionsQuery.reconnectAttempts, userSessionsQuery.streamStatus]);

  const streamLastSeenLabel = useMemo(() => {
    if (!userSessionsQuery.lastSnapshotAt) {
      return 'No live snapshot yet';
    }
    const parsed = new Date(userSessionsQuery.lastSnapshotAt);
    if (Number.isNaN(parsed.getTime())) {
      return 'No live snapshot yet';
    }
    return `Last update ${parsed.toLocaleTimeString()}`;
  }, [userSessionsQuery.lastSnapshotAt]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, setPage, status]);

  useEffect(() => {
    setSelectedUserIds((previous) => previous.filter((id) => users.some((user) => user.id === id)));
  }, [users]);

  useEffect(() => {
    if (!groups.length) {
      if (selectedGroupId !== '') {
        setSelectedGroupId('');
      }
      return;
    }

    const exists = groups.some((group) => String(group.id) === selectedGroupId);
    if (!exists) {
      setSelectedGroupId(String(groups[0].id));
    }
  }, [groups, selectedGroupId]);

  useEffect(() => {
    if (quickAction === 'create') {
      setShowAddModal(true);
      const next = new URLSearchParams(searchParams);
      next.delete('quick');
      setSearchParams(next, { replace: true });
    }
  }, [quickAction, searchParams, setSearchParams]);

  const requestConfirm = ({
    title,
    description,
    confirmLabel = 'Confirm',
    tone = 'danger'
  }: {
    title: string;
    description?: string;
    confirmLabel?: string;
    tone?: 'danger' | 'primary';
  }) =>
    new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmDialog({
        title,
        description,
        confirmLabel,
        tone
      });
    });

  const resolveConfirm = (accepted: boolean) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmDialog(null);
    if (resolver) {
      resolver(accepted);
    }
  };

  const requestPrompt = ({
    title,
    description,
    label,
    placeholder,
    defaultValue = '',
    inputType = 'text',
    confirmLabel = 'Save'
  }: {
    title: string;
    description?: string;
    label?: string;
    placeholder?: string;
    defaultValue?: string;
    inputType?: 'text' | 'number';
    confirmLabel?: string;
  }) =>
    new Promise<string | null>((resolve) => {
      promptResolverRef.current = resolve;
      setPromptDialog({
        title,
        description,
        label,
        placeholder,
        defaultValue,
        inputType,
        confirmLabel
      });
    });

  const resolvePrompt = (value: string | null) => {
    const resolver = promptResolverRef.current;
    promptResolverRef.current = null;
    setPromptDialog(null);
    if (resolver) {
      resolver(value);
    }
  };

  const handleDelete = async (userId: number) => {
    if (!(await requestConfirm({
      title: 'Delete User',
      description: t('users.deleteConfirm', 'Are you sure you want to delete this user?'),
      confirmLabel: 'Delete',
      tone: 'danger'
    }))) {
      return;
    }

    try {
      await deleteUserMutation.mutateAsync(userId);
      await refreshUsersAndSessions();
      toast.success('User deleted');
    } catch (error: any) {
      toast.error('Delete failed', error?.message || 'Failed to delete user');
    }
  };

  const handleExport = () => {
    if (users.length === 0) {
      return;
    }

    const csv = [
      ['Email', 'UUID', 'Status', 'Data Used', 'Data Limit', 'Expire Date'].map(csvCell).join(','),
      ...users.map((user) =>
        [
          user.email,
          user.uuid,
          user.status,
          Number(user.uploadUsed) + Number(user.downloadUsed),
          user.dataLimit,
          user.expireDate
        ]
          .map(csvCell)
          .join(',')
      )
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `users-${new Date().toISOString()}.csv`);
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const clearSelection = () => {
    setSelectedUserIds([]);
  };

  const refreshUsersAndSessions = async (options: { includeGroups?: boolean } = {}) => {
    const tasks: Array<Promise<unknown>> = [
      usersQuery.refetch(),
      userSessionsQuery.refetch()
    ];

    if (options.includeGroups) {
      tasks.push(groupsQuery.refetch());
    }

    await Promise.all(tasks);
  };

  const autoRefresh = useSmartAutoRefresh(
    () => refreshUsersAndSessions(),
    {
      enabled: true,
      intervalMs: 5_000
    }
  );

  const handleSaveCurrentView = async () => {
    const name = await requestPrompt({
      title: 'Save View',
      description: 'Create a reusable filter preset for this Users page.',
      label: 'View name',
      placeholder: 'My team filter',
      confirmLabel: 'Save View'
    });
    if (!name || !name.trim()) {
      return;
    }

    try {
      const view = saveView(name.trim(), {
        search,
        status,
        viewMode
      });
      setSelectedViewId(view.id);
      toast.success('Saved view', `View "${view.name}" saved`);
    } catch (error: any) {
      toast.error('Unable to save view', error?.message || 'Unknown error');
    }
  };

  const applySavedView = (viewId: string) => {
    setSelectedViewId(viewId);
    const selected = savedViews.find((view) => view.id === viewId);
    if (!selected) {
      return;
    }

    usersFilters.setValue((previous) => ({
      ...previous,
      page: 1,
      search: selected.filters.search || '',
      status: selected.filters.status || '',
      viewMode: selected.filters.viewMode || 'auto'
    }));
    toast.success('View applied', `Applied "${selected.name}"`);
  };

  const removeSelectedView = () => {
    if (!selectedViewId) {
      return;
    }

    const selected = savedViews.find((view) => view.id === selectedViewId);
    deleteView(selectedViewId);
    setSelectedViewId('');
    toast.info('View removed', selected ? `Removed "${selected.name}"` : 'Saved view removed');
  };

  const handleBulkDelete = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!(await requestConfirm({
      title: 'Delete Selected Users',
      description: `Delete ${selectedUserIds.length} selected users? This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger'
    }))) {
      return;
    }

    try {
      await bulkDeleteMutation.mutateAsync(selectedUserIds);
      clearSelection();
      await refreshUsersAndSessions();
      toast.success('Users deleted', `${selectedUserIds.length} user(s) deleted.`);
    } catch (error: any) {
      toast.error('Bulk delete failed', error?.message || 'Failed to delete selected users');
    }
  };

  const handleBulkResetTraffic = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!(await requestConfirm({
      title: 'Reset Traffic',
      description: `Reset traffic for ${selectedUserIds.length} selected users?`,
      confirmLabel: 'Reset',
      tone: 'primary'
    }))) {
      return;
    }

    try {
      await bulkResetTrafficMutation.mutateAsync(selectedUserIds);
      clearSelection();
      await refreshUsersAndSessions();
      toast.success('Traffic reset', `${selectedUserIds.length} user(s) reset.`);
    } catch (error: any) {
      toast.error('Bulk reset failed', error?.message || 'Failed to reset traffic');
    }
  };

  const handleBulkExtendExpiry = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    const daysInput = await requestPrompt({
      title: 'Extend Expiry',
      description: `Extend expiry for ${selectedUserIds.length} selected users.`,
      label: 'Days to add',
      defaultValue: '30',
      inputType: 'number',
      confirmLabel: 'Extend'
    });
    if (!daysInput || !daysInput.trim()) {
      return;
    }

    const days = Number.parseInt(daysInput, 10);
    if (Number.isNaN(days) || days < 1) {
      toast.warning('Invalid input', 'Please enter a valid positive number of days.');
      return;
    }

    try {
      await bulkExtendExpiryMutation.mutateAsync({ userIds: selectedUserIds, days });
      clearSelection();
      await refreshUsersAndSessions();
      toast.success('Expiry extended', `${selectedUserIds.length} user(s) extended by ${days} day(s).`);
    } catch (error: any) {
      toast.error('Bulk extend failed', error?.message || 'Failed to extend expiry');
    }
  };

  const handleBulkUpdateStatus = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!(await requestConfirm({
      title: 'Apply Status',
      description: `Set status to ${bulkStatus} for ${selectedUserIds.length} selected users?`,
      confirmLabel: 'Apply',
      tone: 'primary'
    }))) {
      return;
    }

    try {
      await bulkUpdateStatusMutation.mutateAsync({ userIds: selectedUserIds, status: bulkStatus });
      clearSelection();
      await refreshUsersAndSessions();
      toast.success('Status updated', `${selectedUserIds.length} user(s) set to ${bulkStatus}.`);
    } catch (error: any) {
      toast.error('Bulk update failed', error?.message || 'Failed to update status');
    }
  };

  const handleBulkRotateKeys = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!(await requestConfirm({
      title: 'Rotate Credentials',
      description: `Rotate credentials for ${selectedUserIds.length} selected users?`,
      confirmLabel: 'Rotate',
      tone: 'primary'
    }))) {
      return;
    }

    try {
      await bulkRotateKeysMutation.mutateAsync({
        userIds: selectedUserIds,
        data: {
          rotateUuid: true,
          rotatePassword: true,
          rotateSubscriptionToken: true
        }
      });
      clearSelection();
      await refreshUsersAndSessions();
      toast.success('Credentials rotated', `${selectedUserIds.length} user(s) rotated.`);
    } catch (error: any) {
      toast.error('Bulk rotate failed', error?.message || 'Failed to rotate selected user keys');
    }
  };

  const handleBulkRevokeKeys = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!(await requestConfirm({
      title: 'Revoke Access',
      description: `Revoke access for ${selectedUserIds.length} selected users?`,
      confirmLabel: 'Revoke',
      tone: 'danger'
    }))) {
      return;
    }

    try {
      await bulkRevokeKeysMutation.mutateAsync({
        userIds: selectedUserIds,
        data: {
          disableUser: true,
          disableInbounds: true,
          revokeSubscription: true
        }
      });
      clearSelection();
      await refreshUsersAndSessions();
      toast.success('Access revoked', `${selectedUserIds.length} user(s) revoked.`);
    } catch (error: any) {
      toast.error('Bulk revoke failed', error?.message || 'Failed to revoke selected user access');
    }
  };

  const handleQuickLimitUpdate = async (user: User, updates: { ipLimit?: number; deviceLimit?: number }) => {
    try {
      await quickLimitUpdateMutation.mutateAsync({
        userId: user.id,
        payload: updates
      });
      await refreshUsersAndSessions();
    } catch (error: any) {
      toast.error('Limit update failed', error?.message || 'Failed to update user limits');
    }
  };

  const handleBulkAssignToGroup = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!selectedGroupId) {
      toast.warning('Select a group first');
      return;
    }

    const groupId = Number.parseInt(selectedGroupId, 10);
    if (!Number.isInteger(groupId) || groupId < 1) {
      toast.warning('Selected group is invalid.');
      return;
    }

    const targetGroup = groups.find((group) => group.id === groupId);
    const targetLabel = targetGroup?.name || `#${groupId}`;

    if (!(await requestConfirm({
      title: 'Assign To Group',
      description: `Assign ${selectedUserIds.length} selected users to group "${targetLabel}"?`,
      confirmLabel: 'Assign',
      tone: 'primary'
    }))) {
      return;
    }

    try {
      await assignGroupMutation.mutateAsync({
        groupId,
        userIds: selectedUserIds
      });
      clearSelection();
      await refreshUsersAndSessions();
      toast.success('Group assignment updated', `${selectedUserIds.length} user(s) assigned to ${targetLabel}.`);
    } catch (error: any) {
      toast.error('Assign failed', error?.message || 'Failed to assign users to group');
    }
  };

  const handleBulkRemoveFromGroup = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!selectedGroupId) {
      toast.warning('Select a group first');
      return;
    }

    const groupId = Number.parseInt(selectedGroupId, 10);
    if (!Number.isInteger(groupId) || groupId < 1) {
      toast.warning('Selected group is invalid.');
      return;
    }

    const targetGroup = groups.find((group) => group.id === groupId);
    const targetLabel = targetGroup?.name || `#${groupId}`;

    if (!(await requestConfirm({
      title: 'Remove From Group',
      description: `Remove ${selectedUserIds.length} selected users from group "${targetLabel}"?`,
      confirmLabel: 'Remove',
      tone: 'danger'
    }))) {
      return;
    }

    try {
      await removeGroupUsersMutation.mutateAsync({
        groupId,
        userIds: selectedUserIds
      });
      clearSelection();
      await refreshUsersAndSessions();
      toast.success('Group assignment updated', `${selectedUserIds.length} user(s) removed from ${targetLabel}.`);
    } catch (error: any) {
      toast.error('Remove failed', error?.message || 'Failed to remove users from group');
    }
  };

  const handleBulkMoveToGroup = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!selectedGroupId) {
      toast.warning('Select a group first');
      return;
    }

    const groupId = Number.parseInt(selectedGroupId, 10);
    if (!Number.isInteger(groupId) || groupId < 1) {
      toast.warning('Selected group is invalid.');
      return;
    }

    const targetGroup = groups.find((group) => group.id === groupId);
    const targetLabel = targetGroup?.name || `#${groupId}`;

    if (!(await requestConfirm({
      title: 'Move To Group',
      description: `Move ${selectedUserIds.length} selected users exclusively to group "${targetLabel}"?`,
      confirmLabel: 'Move',
      tone: 'primary'
    }))) {
      return;
    }

    try {
      await moveGroupUsersMutation.mutateAsync({
        groupId,
        userIds: selectedUserIds
      });
      clearSelection();
      await refreshUsersAndSessions();
      toast.success('Users moved', `${selectedUserIds.length} user(s) moved to ${targetLabel}.`);
    } catch (error: any) {
      toast.error('Move failed', error?.message || 'Failed to move users to group');
    }
  };

  const handleBulkApplyGroupPolicy = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!selectedGroupId) {
      toast.warning('Select a group first');
      return;
    }

    const groupId = Number.parseInt(selectedGroupId, 10);
    if (!Number.isInteger(groupId) || groupId < 1) {
      toast.warning('Selected group is invalid.');
      return;
    }

    const targetGroup = groups.find((group) => group.id === groupId);
    const targetLabel = targetGroup?.name || `#${groupId}`;

    try {
      const dryRunResponse = await applyGroupPolicyMutation.mutateAsync({
        groupId,
        payload: {
          dryRun: true,
          userIds: selectedUserIds
        }
      });

      const dryRunData = dryRunResponse.data || {};
      const summary = dryRunData.summary || {};
      const preview = Array.isArray(dryRunData.preview) ? dryRunData.preview : [];

      const previewLine = preview
        .slice(0, 2)
        .map((item: any) => `${item.email}: ${Object.keys(item.changes || {}).join(', ') || 'no changes'}`)
        .join('\n');

      const confirmMessage = [
        `Group policy dry-run for "${targetLabel}":`,
        `- target users: ${summary.targetUsers ?? selectedUserIds.length}`,
        `- would update: ${summary.wouldUpdateUsers ?? 0}`,
        `- skipped: ${summary.skippedUsers ?? 0}`,
        previewLine ? `\nPreview:\n${previewLine}` : '',
        '\nApply now?'
      ]
        .filter(Boolean)
        .join('\n');

      if (!(await requestConfirm({
        title: 'Apply Group Policy',
        description: confirmMessage,
        confirmLabel: 'Apply Policy',
        tone: 'primary'
      }))) {
        return;
      }

      await applyGroupPolicyMutation.mutateAsync({
        groupId,
        payload: {
          dryRun: false,
          userIds: selectedUserIds
        }
      });

      clearSelection();
      await refreshUsersAndSessions();
      toast.success('Group policy applied', `${selectedUserIds.length} user(s) updated from ${targetLabel}.`);
    } catch (error: any) {
      toast.error('Policy apply failed', error?.message || 'Failed to apply group policy');
    }
  };

  const handleBulkApplyMyanmarPriority = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    try {
      const dryRunResponse = await bulkMyanmarPriorityMutation.mutateAsync({
        userIds: selectedUserIds,
        dryRun: true
      });

      const dryRunData = dryRunResponse.data || {};
      const summary = dryRunData.summary || {};
      const preview = Array.isArray(dryRunData.preview) ? dryRunData.preview : [];

      const previewLine = preview
        .slice(0, 2)
        .map((item: any) => {
          const before = (item.currentTop3 || []).map((entry: any) => entry.key).join(' > ') || 'none';
          const after = (item.newTop3 || []).map((entry: any) => entry.key).join(' > ') || 'none';
          return `${item.email}: ${before} -> ${after}`;
        })
        .split('\n')
        .filter(Boolean);

      setBulkMyanmarPreviewState({
        userIds: [...selectedUserIds],
        targetUsers: summary.targetUsers ?? selectedUserIds.length,
        wouldUpdateUsers: summary.wouldUpdateUsers ?? 0,
        unchangedUsers: summary.unchangedUsers ?? 0,
        changedKeys: summary.changedKeys ?? 0,
        matchedUsers: summary.matchedUsers ?? 0,
        previewLines: previewLine
      });
    } catch (error: any) {
      toast.error('Myanmar priority failed', error?.message || 'Failed to reorder selected users');
    }
  };

  const handleConfirmBulkMyanmarPriority = async () => {
    if (!bulkMyanmarPreviewState) {
      return;
    }

    try {
      await bulkMyanmarPriorityMutation.mutateAsync({
        userIds: bulkMyanmarPreviewState.userIds,
        dryRun: false
      });

      const updatedCount = bulkMyanmarPreviewState.wouldUpdateUsers ?? 0;
      setBulkMyanmarPreviewState(null);
      clearSelection();
      await refreshUsersAndSessions();
      toast.success('Myanmar priority applied', `${updatedCount} user(s) reordered.`);
    } catch (error: any) {
      toast.error('Myanmar priority failed', error?.message || 'Failed to reorder selected users');
    }
  };

  const handleRotateUserKeys = async (user: User) => {
    if (!(await requestConfirm({
      title: 'Rotate Credentials',
      description: `Rotate all credentials for ${user.email}?`,
      confirmLabel: 'Rotate',
      tone: 'primary'
    }))) {
      return;
    }

    try {
      await rotateKeysMutation.mutateAsync({
        id: user.id,
        data: {
          rotateUuid: true,
          rotatePassword: true,
          rotateSubscriptionToken: true
        }
      });
      await refreshUsersAndSessions();
      toast.success('Credentials rotated', `Updated ${user.email}.`);
    } catch (error: any) {
      toast.error('Rotate failed', error?.message || 'Failed to rotate user keys');
    }
  };

  const handleRevokeUserKeys = async (user: User) => {
    if (!(await requestConfirm({
      title: 'Revoke User Access',
      description: `Revoke all access for ${user.email}? This will disable the user.`,
      confirmLabel: 'Revoke',
      tone: 'danger'
    }))) {
      return;
    }

    try {
      await revokeKeysMutation.mutateAsync({
        id: user.id,
        data: {
          disableUser: true,
          disableInbounds: true,
          revokeSubscription: true
        }
      });
      await refreshUsersAndSessions();
      toast.success('Access revoked', `${user.email} was disabled.`);
    } catch (error: any) {
      toast.error('Revoke failed', error?.message || 'Failed to revoke user access');
    }
  };

  const handleRegenerateSubscription = async (user: User) => {
    if (!(await requestConfirm({
      title: 'Regenerate Subscription Token',
      description: `Regenerate subscription token for ${user.email}?`,
      confirmLabel: 'Regenerate',
      tone: 'primary'
    }))) {
      return;
    }

    try {
      const payload = await regenerateSubscriptionMutation.mutateAsync(user.id);
      const nextLink = `${window.location.origin}/sub/${payload.subscriptionToken}?target=v2ray`;

      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(nextLink);
          copied = true;
        }
      } catch {
        copied = false;
      }

      if (copied) {
        toast.success('Subscription regenerated', `New link for ${user.email} was copied.`);
      } else {
        toast.success('Subscription regenerated', `Token updated for ${user.email}.`);
      }
      await refreshUsersAndSessions();
    } catch (error: any) {
      toast.error('Token regeneration failed', error?.message || 'Failed to regenerate subscription token');
    }
  };

  const handleQuickResetTraffic = async (user: User) => {
    if (!(await requestConfirm({
      title: 'Reset User Traffic',
      description: `Reset traffic for ${user.email}?`,
      confirmLabel: 'Reset',
      tone: 'primary'
    }))) {
      return;
    }

    try {
      await usersApi.resetTraffic(user.id);
      await refreshUsersAndSessions();
      toast.success('Traffic reset', `${user.email} counters were reset.`);
    } catch (error: any) {
      toast.error('Reset failed', error?.message || 'Failed to reset user traffic');
    }
  };

  const handleQuickExtendExpiry = async (user: User, days: number) => {
    try {
      await usersApi.extendExpiry(user.id, days);
      await refreshUsersAndSessions();
      toast.success('Expiry extended', `${user.email} extended by ${days} day(s).`);
    } catch (error: any) {
      toast.error('Extend failed', error?.message || 'Failed to extend user expiry');
    }
  };

  const handleQuickDisableUser = async (user: User) => {
    if (!(await requestConfirm({
      title: 'Disable User',
      description: `Disable ${user.email}?`,
      confirmLabel: 'Disable',
      tone: 'danger'
    }))) {
      return;
    }

    try {
      await usersApi.updateUser(user.id, { status: 'DISABLED' });
      await usersApi.disconnectUserSessions(user.id);
      await refreshUsersAndSessions();
      toast.success('User banned', `${user.email} is now disabled and disconnected.`);
    } catch (error: any) {
      toast.error('Ban failed', error?.message || 'Failed to disable user');
    }
  };

  const handleQuickDisconnectSessions = async (user: User) => {
    if (!(await requestConfirm({
      title: 'Disconnect Sessions',
      description: `Disconnect all active sessions for ${user.email}?`,
      confirmLabel: 'Disconnect',
      tone: 'danger'
    }))) {
      return;
    }

    try {
      const response = await usersApi.disconnectUserSessions(user.id);
      await refreshUsersAndSessions();
      const summary = response?.data
        ? `${response.data.disconnectedDevices} device(s), ${response.data.disconnectedIps} IP(s)`
        : 'Active sessions disconnected.';
      toast.success('Sessions disconnected', summary);
    } catch (error: any) {
      toast.error('Disconnect failed', error?.message || 'Failed to disconnect active sessions');
    }
  };

  const handleCopySubscriptionLink = async (user: User) => {
    const link = `${window.location.origin}/sub/${user.subscriptionToken}?target=v2ray`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Copied to clipboard', 'Subscription link copied to clipboard.');
    } catch {
      toast.warning('Clipboard unavailable', `Copy failed. Use this link manually:\n${link}`, 10000);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{t('users.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('users.subtitle', 'Manage your VPN users and subscriptions')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handleExport} disabled={users.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            {t('common.export', 'Export CSV')}
          </Button>
          <Button variant="secondary" onClick={() => setShowBulkModal(true)}>
            <UsersIcon className="mr-2 h-4 w-4" />
            Bulk Provision
          </Button>
          <Button onClick={() => setShowAddModal(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('users.addUser')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted">{t('dashboard.totalUsers')}</p>
              <p className="text-2xl font-bold text-foreground">{pagination?.total || users.length}</p>
            </div>
            <UsersIcon className="h-6 w-6 text-brand-500" />
          </div>
        </Card>
        <Card>
          <p className="text-sm text-muted">{t('dashboard.activeUsers')}</p>
          <p className="text-2xl font-bold text-emerald-500">{activeCount}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Online</p>
          <div className="flex items-center gap-2">
            <span className="relative inline-flex h-3 w-3">
              {onlineCount > 0 ? (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
              ) : null}
              <span className={`relative inline-flex h-3 w-3 rounded-full ${onlineCount > 0 ? 'bg-emerald-500' : 'bg-gray-400 dark:bg-gray-500'}`} />
            </span>
            <p className="text-2xl font-bold text-foreground">{onlineCount}</p>
          </div>
          <p className="mt-1 text-xs text-muted">
            Session stream: {streamStatusLabel}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {streamLastSeenLabel}
            {userSessionsQuery.streamError ? ` • ${userSessionsQuery.streamError}` : ''}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">{t('users.limited', 'Limited Users')}</p>
          <p className="text-2xl font-bold text-amber-500">{limitedCount}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">{t('dashboard.expiredUsers')}</p>
          <p className="text-2xl font-bold text-rose-500">{expiredCount}</p>
        </Card>
      </div>

      <Card>
        <div className="space-y-3">
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
                <Input
                  placeholder={t('users.searchPlaceholder', 'Search by email or UUID...')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <select
              className="rounded-xl border border-line/80 bg-card/75 px-4 py-2 text-sm text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/35"
              value={status}
              onChange={(event) => setStatus(event.target.value as UserStatus | '')}
            >
              <option value="">{t('users.allStatus', 'All Status')}</option>
              <option value="ACTIVE">{t('status.active')}</option>
              <option value="LIMITED">{t('status.limited', 'Limited')}</option>
              <option value="DISABLED">{t('status.disabled', 'Disabled')}</option>
              <option value="EXPIRED">{t('status.expired', 'Expired')}</option>
            </select>

            <Button
              variant="secondary"
              onClick={() => {
                void autoRefresh.forceRefresh();
              }}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${usersQuery.isFetching || userSessionsQuery.isFetching ? 'animate-spin' : ''}`} />
              {t('common.refresh', 'Refresh')}
            </Button>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-line/70 bg-panel/40 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="min-w-[180px] rounded-xl border border-line/80 bg-card/75 px-3 py-2 text-sm text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/35"
                value={selectedViewId}
                onChange={(event) => applySavedView(event.target.value)}
              >
                <option value="">Saved views</option>
                {savedViews.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void handleSaveCurrentView();
                }}
              >
                Save View
              </Button>
              <Button size="sm" variant="ghost" onClick={removeSelectedView} disabled={!selectedViewId}>
                Remove View
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-line/70 bg-card/70 p-1">
                {(['auto', 'table', 'cards'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      viewMode === mode
                        ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white'
                        : 'text-muted hover:text-foreground'
                    }`}
                  >
                    {mode.toUpperCase()}
                  </button>
                ))}
              </div>
              <Button size="sm" variant="ghost" onClick={autoRefresh.togglePaused}>
                {autoRefresh.paused ? 'Resume Auto' : 'Pause Auto'}
              </Button>
              <span className="text-xs text-muted">
                Auto refresh: {autoRefresh.statusLabel} ({Math.ceil(autoRefresh.nextRunInMs / 1000)}s)
              </span>
            </div>
          </div>
        </div>
      </Card>

      <Card padding={false}>
        {selectedUserIds.length > 0 ? (
          <div className="border-b border-line/70 bg-panel/50 px-4 py-3 sm:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="text-sm text-foreground">
                {selectedUserIds.length} selected
                {selectedUsers.length > 0 ? ` (${selectedUsers.map((user) => user.email).slice(0, 2).join(', ')}${selectedUsers.length > 2 ? ', ...' : ''})` : ''}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    clearSelection();
                  }}
                  disabled={isBulkMutating}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void handleBulkResetTraffic();
                  }}
                  loading={bulkResetTrafficMutation.isPending}
                  disabled={isBulkMutating}
                >
                  Reset Traffic
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void handleBulkExtendExpiry();
                  }}
                  loading={bulkExtendExpiryMutation.isPending}
                  disabled={isBulkMutating}
                >
                  Extend Expiry
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void handleBulkRotateKeys();
                  }}
                  loading={bulkRotateKeysMutation.isPending}
                  disabled={isBulkMutating}
                >
                  Rotate Keys
                </Button>
                {canRevokeUsers ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void handleBulkRevokeKeys();
                    }}
                    loading={bulkRevokeKeysMutation.isPending}
                    disabled={isBulkMutating}
                  >
                    Revoke Access
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void handleBulkApplyMyanmarPriority();
                  }}
                  loading={bulkMyanmarPriorityMutation.isPending}
                  disabled={isBulkMutating}
                >
                  Myanmar Priority
                </Button>
                {groups.length > 0 ? (
                  <div className="flex items-center gap-2 rounded-lg border border-line/70 bg-card/80 px-2 py-1">
                    <select
                      value={selectedGroupId}
                      onChange={(event) => setSelectedGroupId(event.target.value)}
                      className="max-w-[13rem] rounded-md border border-line/60 bg-card/80 px-2 py-1 text-xs text-foreground focus:border-brand-500/60 focus:outline-none"
                      disabled={isBulkMutating || groupsQuery.isFetching}
                    >
                      {groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void handleBulkAssignToGroup();
                      }}
                      loading={assignGroupMutation.isPending}
                      disabled={isBulkMutating || !selectedGroupId}
                    >
                      Assign
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void handleBulkMoveToGroup();
                      }}
                      loading={moveGroupUsersMutation.isPending}
                      disabled={isBulkMutating || !selectedGroupId}
                    >
                      Move
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void handleBulkRemoveFromGroup();
                      }}
                      loading={removeGroupUsersMutation.isPending}
                      disabled={isBulkMutating || !selectedGroupId}
                    >
                      Remove
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void handleBulkApplyGroupPolicy();
                      }}
                      loading={applyGroupPolicyMutation.isPending}
                      disabled={isBulkMutating || !selectedGroupId}
                    >
                      Apply Policy
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => navigate('/groups')}
                    disabled={groupsQuery.isFetching}
                  >
                    Create Group
                  </Button>
                )}
                <div className="flex items-center gap-2 rounded-lg border border-line/70 bg-card/80 px-2 py-1">
                  <select
                    value={bulkStatus}
                    onChange={(event) => setBulkStatus(event.target.value as UserStatus)}
                    className="rounded-md border border-line/60 bg-card/80 px-2 py-1 text-xs text-foreground focus:border-brand-500/60 focus:outline-none"
                    disabled={isBulkMutating}
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="LIMITED">LIMITED</option>
                    <option value="DISABLED">DISABLED</option>
                    <option value="EXPIRED">EXPIRED</option>
                  </select>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void handleBulkUpdateStatus();
                    }}
                    loading={bulkUpdateStatusMutation.isPending}
                    disabled={isBulkMutating}
                  >
                    Apply Status
                  </Button>
                </div>
                {canDeleteUsers ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      void handleBulkDelete();
                    }}
                    loading={bulkDeleteMutation.isPending}
                    disabled={isBulkMutating}
                  >
                    Delete Selected
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {usersQuery.isLoading ? (
          <div className="space-y-4 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-8 rounded-lg" />
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-muted">{t('users.noUsers', 'No users found')}</p>
            <Button className="mt-4" onClick={() => setShowAddModal(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t('users.addFirst')}
            </Button>
          </div>
        ) : (
          <UserTable
            users={users}
            viewMode={viewMode}
            onlineUuidSet={onlineUuidSet}
            sessionsByUserId={sessionsByUserId}
            onQuickQr={(user) => setQuickQrUser(user)}
            onQuickEdit={(user) => setQuickEditUser(user)}
            onRotateKeys={(user) => {
              void handleRotateUserKeys(user);
            }}
            onRevokeKeys={canRevokeUsers
              ? (user) => {
                  void handleRevokeUserKeys(user);
                }
              : undefined}
            onDisconnectSessions={(user) => {
              void handleQuickDisconnectSessions(user);
            }}
            onRegenerateSubscription={(user) => {
              void handleRegenerateSubscription(user);
            }}
            onResetTraffic={(user) => {
              void handleQuickResetTraffic(user);
            }}
            onExtendExpiry={(user, days) => {
              void handleQuickExtendExpiry(user, days);
            }}
            onDisableUser={canRevokeUsers
              ? (user) => {
                  void handleQuickDisableUser(user);
                }
              : undefined}
            onCopySubscription={(user) => {
              void handleCopySubscriptionLink(user);
            }}
            onUpdateLimits={(user, updates) => {
              void handleQuickLimitUpdate(user, updates);
            }}
            selectedUserIds={selectedUserIds}
            onSelectionChange={setSelectedUserIds}
            onPrefetch={(user) => {
              prefetchRoute(`/users/${user.id}`);
            }}
            onView={(user) => {
              prefetchRoute(`/users/${user.id}`);
              navigate(`/users/${user.id}`);
            }}
            onDelete={canDeleteUsers
              ? (id) => {
                  void handleDelete(id);
                }
              : undefined}
          />
        )}
      </Card>

      {pagination && pagination.totalPages > 1 ? (
        <Card className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="text-sm text-muted">
            {t('common.showing', { count: users.length, total: pagination.total })}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>
              {t('common.previous')}
            </Button>
            <span className="px-3 text-sm text-foreground/85">
              {t('common.page', { current: page, total: pagination.totalPages })}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((prev) => prev + 1)}
            >
              {t('common.next')}
            </Button>
          </div>
        </Card>
      ) : null}

      {showAddModal ? (
        <UserFormModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            void refreshUsersAndSessions();
          }}
        />
      ) : null}

      {showBulkModal ? (
        <UserBulkCreateModal
          onClose={() => setShowBulkModal(false)}
          onSuccess={() => {
            setShowBulkModal(false);
            void refreshUsersAndSessions();
          }}
        />
      ) : null}

      {quickQrUser ? <UserQuickQrModal user={quickQrUser} onClose={() => setQuickQrUser(null)} /> : null}

      {quickEditUser ? (
        <UserQuickEditModal
          user={quickEditUser}
          onClose={() => setQuickEditUser(null)}
          onSuccess={() => {
            setQuickEditUser(null);
            void refreshUsersAndSessions();
          }}
        />
      ) : null}

      <MyanmarPriorityPreviewModal
        open={Boolean(bulkMyanmarPreviewState)}
        title="Bulk Myanmar Priority Preview"
        description="Review the dry-run summary before applying reorder to selected users."
        summaryRows={[
          { label: 'Target Users', value: bulkMyanmarPreviewState?.targetUsers ?? 0 },
          { label: 'Would Reorder', value: bulkMyanmarPreviewState?.wouldUpdateUsers ?? 0 },
          { label: 'Unchanged', value: bulkMyanmarPreviewState?.unchangedUsers ?? 0 }
        ]}
        previewLines={bulkMyanmarPreviewState?.previewLines || []}
        confirmLabel="Apply Bulk Priority"
        loading={bulkMyanmarPriorityMutation.isPending}
        disableConfirm={!bulkMyanmarPreviewState || bulkMyanmarPreviewState.wouldUpdateUsers === 0}
        onClose={() => {
          if (!bulkMyanmarPriorityMutation.isPending) {
            setBulkMyanmarPreviewState(null);
          }
        }}
        onConfirm={() => {
          void handleConfirmBulkMyanmarPriority();
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title || 'Confirm'}
        description={confirmDialog?.description}
        confirmLabel={confirmDialog?.confirmLabel || 'Confirm'}
        tone={confirmDialog?.tone || 'danger'}
        onCancel={() => resolveConfirm(false)}
        onConfirm={() => resolveConfirm(true)}
      />

      <PromptDialog
        open={Boolean(promptDialog)}
        title={promptDialog?.title || 'Enter value'}
        description={promptDialog?.description}
        label={promptDialog?.label}
        placeholder={promptDialog?.placeholder}
        defaultValue={promptDialog?.defaultValue}
        inputType={promptDialog?.inputType}
        confirmLabel={promptDialog?.confirmLabel || 'Save'}
        onCancel={() => resolvePrompt(null)}
        onConfirm={(value) => resolvePrompt(value)}
      />
    </div>
  );
}

export const UsersPage = Users;
