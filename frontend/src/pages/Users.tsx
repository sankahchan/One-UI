import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Download, MoreVertical, Plus, RefreshCw, Search, Users as UsersIcon } from 'lucide-react';
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
  const [bulkQualityPreviewState, setBulkQualityPreviewState] = useState<{
    userIds: number[];
    targetUsers: number;
    wouldUpdateUsers: number;
    unchangedUsers: number;
    changedKeys: number;
    scoredKeys: number;
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
  const bulkQualityOrderMutation = useMutation({
    mutationFn: ({ userIds, dryRun, windowMinutes }: { userIds: number[]; dryRun?: boolean; windowMinutes?: number }) =>
      usersApi.bulkReorderUserInboundsByQuality({
        userIds,
        windowMinutes,
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
    || bulkQualityOrderMutation.isPending
    || assignGroupMutation.isPending
    || removeGroupUsersMutation.isPending
    || moveGroupUsersMutation.isPending
    || applyGroupPolicyMutation.isPending;

  const streamStatusLabel = useMemo(() => {
    if (userSessionsQuery.streamStatus === 'connected') {
      return t('users.streamStatus.connected', { defaultValue: 'Connected' });
    }
    if (userSessionsQuery.streamStatus === 'connecting') {
      return userSessionsQuery.reconnectAttempts > 0
        ? t('users.streamStatus.reconnecting', {
          defaultValue: 'Reconnecting ({{count}})',
          count: userSessionsQuery.reconnectAttempts
        })
        : t('users.streamStatus.connecting', { defaultValue: 'Connecting' });
    }
    if (userSessionsQuery.streamStatus === 'error') {
      return t('common.error', { defaultValue: 'Error' });
    }
    return t('users.streamStatus.idle', { defaultValue: 'Idle' });
  }, [t, userSessionsQuery.reconnectAttempts, userSessionsQuery.streamStatus]);

  const streamLastSeenLabel = useMemo(() => {
    if (!userSessionsQuery.lastSnapshotAt) {
      return t('users.streamSnapshot.none', { defaultValue: 'No live snapshot yet' });
    }
    const parsed = new Date(userSessionsQuery.lastSnapshotAt);
    if (Number.isNaN(parsed.getTime())) {
      return t('users.streamSnapshot.none', { defaultValue: 'No live snapshot yet' });
    }
    return t('users.streamSnapshot.lastUpdate', {
      defaultValue: 'Last update {{time}}',
      time: parsed.toLocaleTimeString()
    });
  }, [t, userSessionsQuery.lastSnapshotAt]);

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
      title: t('users.deleteUser', { defaultValue: 'Delete User' }),
      description: t('users.confirmDelete', { defaultValue: 'Are you sure you want to delete this user?' }),
      confirmLabel: t('common.delete', { defaultValue: 'Delete' }),
      tone: 'danger'
    }))) {
      return;
    }

    try {
      await deleteUserMutation.mutateAsync(userId);
      await refreshUsersAndSessions();
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.userDeleted', { defaultValue: 'User deleted successfully' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.deleteFailed', { defaultValue: 'Failed to delete user' })
      );
    }
  };

  const handleExport = () => {
    if (users.length === 0) {
      return;
    }

    const csv = [
      [
        t('users.email', { defaultValue: 'Email' }),
        t('users.uuid', { defaultValue: 'UUID' }),
        t('common.status', { defaultValue: 'Status' }),
        t('users.dataUsed', { defaultValue: 'Data Used' }),
        t('users.dataLimit', { defaultValue: 'Data Limit' }),
        t('users.expireDate', { defaultValue: 'Expire Date' })
      ]
        .map(csvCell)
        .join(','),
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

  const closeDropdownMenu = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    const details = element?.closest('details') as HTMLDetailsElement | null;
    if (details) {
      details.open = false;
    }
  };

  const runBulkMenuAction = (event: MouseEvent<HTMLButtonElement>, action: (() => void) | undefined) => {
    event.preventDefault();
    event.stopPropagation();
    if (action) {
      action();
    }
    closeDropdownMenu(event.currentTarget);
  };

  const refreshUsersAndSessions = async (options: { includeGroups?: boolean } = {}) => {
    const tasks: Array<Promise<unknown>> = [
      usersQuery.refetch()
    ];

    if (userSessionsQuery.streamStatus !== 'connected') {
      tasks.push(userSessionsQuery.refetch());
    }

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
      title: t('common.saveView', { defaultValue: 'Save View' }),
      description: t('users.views.saveDescription', {
        defaultValue: 'Create a reusable filter preset for this Users page.'
      }),
      label: t('users.views.nameLabel', { defaultValue: 'View name' }),
      placeholder: t('users.views.namePlaceholder', { defaultValue: 'My team filter' }),
      confirmLabel: t('common.saveView', { defaultValue: 'Save View' })
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
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.views.savedToast', { defaultValue: 'View "{{name}}" saved', name: view.name })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.views.saveFailed', { defaultValue: 'Unable to save view' })
      );
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
    toast.success(
      t('common.success', { defaultValue: 'Success' }),
      t('users.views.appliedToast', { defaultValue: 'Applied "{{name}}"', name: selected.name })
    );
  };

  const removeSelectedView = () => {
    if (!selectedViewId) {
      return;
    }

    const selected = savedViews.find((view) => view.id === selectedViewId);
    deleteView(selectedViewId);
    setSelectedViewId('');
    toast.info(
      t('common.info', { defaultValue: 'Info' }),
      selected
        ? t('users.views.removedToast', { defaultValue: 'Removed "{{name}}"', name: selected.name })
        : t('users.views.removedToastGeneric', { defaultValue: 'Saved view removed' })
    );
  };

  const handleBulkDelete = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!(await requestConfirm({
      title: t('users.bulk.deleteTitle', { defaultValue: 'Delete Selected Users' }),
      description: t('users.bulk.deleteDescription', {
        defaultValue: 'Delete {{count}} selected users? This cannot be undone.',
        count: selectedUserIds.length
      }),
      confirmLabel: t('common.delete', { defaultValue: 'Delete' }),
      tone: 'danger'
    }))) {
      return;
    }

    try {
      await bulkDeleteMutation.mutateAsync(selectedUserIds);
      clearSelection();
      await refreshUsersAndSessions();
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.toast.bulkDeleted', { defaultValue: '{{count}} user(s) deleted.', count: selectedUserIds.length })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.bulkDeleteFailed', { defaultValue: 'Failed to delete selected users' })
      );
    }
  };

  const handleBulkResetTraffic = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!(await requestConfirm({
      title: t('users.bulk.resetTrafficTitle', { defaultValue: 'Reset Traffic' }),
      description: t('users.bulk.resetTrafficDescription', {
        defaultValue: 'Reset traffic for {{count}} selected users?',
        count: selectedUserIds.length
      }),
      confirmLabel: t('common.reset', { defaultValue: 'Reset' }),
      tone: 'primary'
    }))) {
      return;
    }

    try {
      await bulkResetTrafficMutation.mutateAsync(selectedUserIds);
      clearSelection();
      await refreshUsersAndSessions();
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.toast.bulkTrafficReset', { defaultValue: '{{count}} user(s) reset.', count: selectedUserIds.length })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.bulkResetFailed', { defaultValue: 'Failed to reset traffic' })
      );
    }
  };

  const handleBulkExtendExpiry = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    const daysInput = await requestPrompt({
      title: t('users.bulk.extendExpiryTitle', { defaultValue: 'Extend Expiry' }),
      description: t('users.bulk.extendExpiryDescription', {
        defaultValue: 'Extend expiry for {{count}} selected users.',
        count: selectedUserIds.length
      }),
      label: t('users.bulk.daysToAdd', { defaultValue: 'Days to add' }),
      defaultValue: '30',
      inputType: 'number',
      confirmLabel: t('common.extend', { defaultValue: 'Extend' })
    });
    if (!daysInput || !daysInput.trim()) {
      return;
    }

    const days = Number.parseInt(daysInput, 10);
    if (Number.isNaN(days) || days < 1) {
      toast.warning(
        t('common.warning', { defaultValue: 'Warning' }),
        t('users.toast.invalidDays', { defaultValue: 'Please enter a valid positive number of days.' })
      );
      return;
    }

    try {
      await bulkExtendExpiryMutation.mutateAsync({ userIds: selectedUserIds, days });
      clearSelection();
      await refreshUsersAndSessions();
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.toast.bulkExpiryExtended', {
          defaultValue: '{{count}} user(s) extended by {{days}} day(s).',
          count: selectedUserIds.length,
          days
        })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.bulkExtendFailed', { defaultValue: 'Failed to extend expiry' })
      );
    }
  };

  const handleBulkUpdateStatus = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!(await requestConfirm({
      title: t('users.bulk.applyStatusTitle', { defaultValue: 'Apply Status' }),
      description: t('users.bulk.applyStatusDescription', {
        defaultValue: 'Set status to {{status}} for {{count}} selected users?',
        status: bulkStatus,
        count: selectedUserIds.length
      }),
      confirmLabel: t('common.apply', { defaultValue: 'Apply' }),
      tone: 'primary'
    }))) {
      return;
    }

    try {
      await bulkUpdateStatusMutation.mutateAsync({ userIds: selectedUserIds, status: bulkStatus });
      clearSelection();
      await refreshUsersAndSessions();
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.toast.bulkStatusUpdated', {
          defaultValue: '{{count}} user(s) set to {{status}}.',
          count: selectedUserIds.length,
          status: bulkStatus
        })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.bulkUpdateFailed', { defaultValue: 'Failed to update status' })
      );
    }
  };

  const handleBulkRotateKeys = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!(await requestConfirm({
      title: t('users.bulk.rotateTitle', { defaultValue: 'Rotate Credentials' }),
      description: t('users.bulk.rotateDescription', {
        defaultValue: 'Rotate credentials for {{count}} selected users?',
        count: selectedUserIds.length
      }),
      confirmLabel: t('common.rotate', { defaultValue: 'Rotate' }),
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
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.toast.bulkRotated', { defaultValue: '{{count}} user(s) rotated.', count: selectedUserIds.length })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.bulkRotateFailed', { defaultValue: 'Failed to rotate selected user keys' })
      );
    }
  };

  const handleBulkRevokeKeys = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!(await requestConfirm({
      title: t('users.bulk.revokeTitle', { defaultValue: 'Revoke Access' }),
      description: t('users.bulk.revokeDescription', {
        defaultValue: 'Revoke access for {{count}} selected users?',
        count: selectedUserIds.length
      }),
      confirmLabel: t('common.revoke', { defaultValue: 'Revoke' }),
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
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.toast.bulkRevoked', { defaultValue: '{{count}} user(s) revoked.', count: selectedUserIds.length })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.bulkRevokeFailed', { defaultValue: 'Failed to revoke selected user access' })
      );
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
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.limitUpdateFailed', { defaultValue: 'Failed to update user limits' })
      );
    }
  };

  const handleBulkAssignToGroup = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!selectedGroupId) {
      toast.warning(
        t('common.warning', { defaultValue: 'Warning' }),
        t('users.toast.selectGroupFirst', { defaultValue: 'Select a group first' })
      );
      return;
    }

    const groupId = Number.parseInt(selectedGroupId, 10);
    if (!Number.isInteger(groupId) || groupId < 1) {
      toast.warning(
        t('common.warning', { defaultValue: 'Warning' }),
        t('users.toast.groupInvalid', { defaultValue: 'Selected group is invalid.' })
      );
      return;
    }

    const targetGroup = groups.find((group) => group.id === groupId);
    const targetLabel = targetGroup?.name || `#${groupId}`;

    if (!(await requestConfirm({
      title: t('users.bulk.assignTitle', { defaultValue: 'Assign To Group' }),
      description: t('users.bulk.assignDescription', {
        defaultValue: 'Assign {{count}} selected users to group "{{group}}"?',
        count: selectedUserIds.length,
        group: targetLabel
      }),
      confirmLabel: t('common.assign', { defaultValue: 'Assign' }),
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
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.toast.assignedToGroup', {
          defaultValue: '{{count}} user(s) assigned to {{group}}.',
          count: selectedUserIds.length,
          group: targetLabel
        })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.assignFailed', { defaultValue: 'Failed to assign users to group' })
      );
    }
  };

  const handleBulkRemoveFromGroup = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!selectedGroupId) {
      toast.warning(
        t('common.warning', { defaultValue: 'Warning' }),
        t('users.toast.selectGroupFirst', { defaultValue: 'Select a group first' })
      );
      return;
    }

    const groupId = Number.parseInt(selectedGroupId, 10);
    if (!Number.isInteger(groupId) || groupId < 1) {
      toast.warning(
        t('common.warning', { defaultValue: 'Warning' }),
        t('users.toast.groupInvalid', { defaultValue: 'Selected group is invalid.' })
      );
      return;
    }

    const targetGroup = groups.find((group) => group.id === groupId);
    const targetLabel = targetGroup?.name || `#${groupId}`;

    if (!(await requestConfirm({
      title: t('users.bulk.removeTitle', { defaultValue: 'Remove From Group' }),
      description: t('users.bulk.removeDescription', {
        defaultValue: 'Remove {{count}} selected users from group "{{group}}"?',
        count: selectedUserIds.length,
        group: targetLabel
      }),
      confirmLabel: t('common.remove', { defaultValue: 'Remove' }),
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
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.toast.removedFromGroup', {
          defaultValue: '{{count}} user(s) removed from {{group}}.',
          count: selectedUserIds.length,
          group: targetLabel
        })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.removeFailed', { defaultValue: 'Failed to remove users from group' })
      );
    }
  };

  const handleBulkMoveToGroup = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!selectedGroupId) {
      toast.warning(
        t('common.warning', { defaultValue: 'Warning' }),
        t('users.toast.selectGroupFirst', { defaultValue: 'Select a group first' })
      );
      return;
    }

    const groupId = Number.parseInt(selectedGroupId, 10);
    if (!Number.isInteger(groupId) || groupId < 1) {
      toast.warning(
        t('common.warning', { defaultValue: 'Warning' }),
        t('users.toast.groupInvalid', { defaultValue: 'Selected group is invalid.' })
      );
      return;
    }

    const targetGroup = groups.find((group) => group.id === groupId);
    const targetLabel = targetGroup?.name || `#${groupId}`;

    if (!(await requestConfirm({
      title: t('users.bulk.moveTitle', { defaultValue: 'Move To Group' }),
      description: t('users.bulk.moveDescription', {
        defaultValue: 'Move {{count}} selected users exclusively to group "{{group}}"?',
        count: selectedUserIds.length,
        group: targetLabel
      }),
      confirmLabel: t('common.move', { defaultValue: 'Move' }),
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
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.toast.movedToGroup', {
          defaultValue: '{{count}} user(s) moved to {{group}}.',
          count: selectedUserIds.length,
          group: targetLabel
        })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.moveFailed', { defaultValue: 'Failed to move users to group' })
      );
    }
  };

  const handleBulkApplyGroupPolicy = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    if (!selectedGroupId) {
      toast.warning(
        t('common.warning', { defaultValue: 'Warning' }),
        t('users.toast.selectGroupFirst', { defaultValue: 'Select a group first' })
      );
      return;
    }

    const groupId = Number.parseInt(selectedGroupId, 10);
    if (!Number.isInteger(groupId) || groupId < 1) {
      toast.warning(
        t('common.warning', { defaultValue: 'Warning' }),
        t('users.toast.groupInvalid', { defaultValue: 'Selected group is invalid.' })
      );
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
        .map((item: any) => `${item.email}: ${Object.keys(item.changes || {}).join(', ') || t('common.noChanges', { defaultValue: 'no changes' })}`)
        .join('\n');

      const confirmMessage = [
        t('users.bulk.policyDryRunTitle', { defaultValue: 'Group policy dry-run for "{{group}}":', group: targetLabel }),
        t('users.bulk.policyDryRunTarget', {
          defaultValue: '- target users: {{count}}',
          count: summary.targetUsers ?? selectedUserIds.length
        }),
        t('users.bulk.policyDryRunWouldUpdate', { defaultValue: '- would update: {{count}}', count: summary.wouldUpdateUsers ?? 0 }),
        t('users.bulk.policyDryRunSkipped', { defaultValue: '- skipped: {{count}}', count: summary.skippedUsers ?? 0 }),
        previewLine ? `\n${t('common.preview', { defaultValue: 'Preview' })}:\n${previewLine}` : '',
        `\n${t('users.bulk.applyNow', { defaultValue: 'Apply now?' })}`
      ]
        .filter(Boolean)
        .join('\n');

      if (!(await requestConfirm({
        title: t('users.bulk.applyPolicyTitle', { defaultValue: 'Apply Group Policy' }),
        description: confirmMessage,
        confirmLabel: t('users.bulk.applyPolicyConfirm', { defaultValue: 'Apply Policy' }),
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
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.toast.policyApplied', {
          defaultValue: '{{count}} user(s) updated from {{group}}.',
          count: selectedUserIds.length,
          group: targetLabel
        })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.policyApplyFailed', { defaultValue: 'Failed to apply group policy' })
      );
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
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.myanmarPriorityFailed', { defaultValue: 'Failed to reorder selected users' })
      );
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
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.toast.myanmarPriorityApplied', { defaultValue: '{{count}} user(s) reordered.', count: updatedCount })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.myanmarPriorityFailed', { defaultValue: 'Failed to reorder selected users' })
      );
    }
  };

  const handleBulkApplyQualityOrder = async () => {
    if (selectedUserIds.length === 0) {
      return;
    }

    try {
      const dryRunResponse = await bulkQualityOrderMutation.mutateAsync({
        userIds: selectedUserIds,
        windowMinutes: 60,
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
        .filter(Boolean);

      setBulkQualityPreviewState({
        userIds: [...selectedUserIds],
        targetUsers: summary.targetUsers ?? selectedUserIds.length,
        wouldUpdateUsers: summary.wouldUpdateUsers ?? 0,
        unchangedUsers: summary.unchangedUsers ?? 0,
        changedKeys: summary.changedKeys ?? 0,
        scoredKeys: summary.scoredKeys ?? 0,
        previewLines: previewLine
      });
    } catch (error: any) {
      toast.error(
        t('users.autoTuneFailedTitle', { defaultValue: 'Auto-tune failed' }),
        error?.message || t('users.autoTuneFailedBody', { defaultValue: 'Failed to auto-tune selected users' })
      );
    }
  };

  const handleConfirmBulkQualityOrder = async () => {
    if (!bulkQualityPreviewState) {
      return;
    }

    try {
      await bulkQualityOrderMutation.mutateAsync({
        userIds: bulkQualityPreviewState.userIds,
        windowMinutes: 60,
        dryRun: false
      });

      const updatedCount = bulkQualityPreviewState.wouldUpdateUsers ?? 0;
      setBulkQualityPreviewState(null);
      clearSelection();
      await refreshUsersAndSessions();
      toast.success(
        t('users.autoTuneAppliedTitle', { defaultValue: 'Auto-tune applied' }),
        t('users.autoTuneAppliedBody', { defaultValue: '{{count}} user(s) reordered.', count: updatedCount })
      );
    } catch (error: any) {
      toast.error(
        t('users.autoTuneFailedTitle', { defaultValue: 'Auto-tune failed' }),
        error?.message || t('users.autoTuneFailedBody', { defaultValue: 'Failed to auto-tune selected users' })
      );
    }
  };

  const handleRotateUserKeys = async (user: User) => {
    if (!(await requestConfirm({
      title: t('users.actions.rotateTitle', { defaultValue: 'Rotate Credentials' }),
      description: t('users.actions.rotateDescription', {
        defaultValue: 'Rotate all credentials for {{email}}?',
        email: user.email
      }),
      confirmLabel: t('common.rotate', { defaultValue: 'Rotate' }),
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
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.toast.rotated', { defaultValue: 'Updated {{email}}.', email: user.email })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.rotateFailed', { defaultValue: 'Failed to rotate user keys' })
      );
    }
  };

  const handleRevokeUserKeys = async (user: User) => {
    if (!(await requestConfirm({
      title: t('users.actions.revokeTitle', { defaultValue: 'Revoke User Access' }),
      description: t('users.actions.revokeDescription', {
        defaultValue: 'Revoke all access for {{email}}? This will disable the user.',
        email: user.email
      }),
      confirmLabel: t('common.revoke', { defaultValue: 'Revoke' }),
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
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.toast.accessRevoked', { defaultValue: '{{email}} was disabled.', email: user.email })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.revokeFailed', { defaultValue: 'Failed to revoke user access' })
      );
    }
  };

  const handleRegenerateSubscription = async (user: User) => {
    if (!(await requestConfirm({
      title: t('users.actions.regenerateTitle', { defaultValue: 'Regenerate Subscription Token' }),
      description: t('users.actions.regenerateDescription', {
        defaultValue: 'Regenerate subscription token for {{email}}?',
        email: user.email
      }),
      confirmLabel: t('common.regenerate', { defaultValue: 'Regenerate' }),
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
        toast.success(
          t('common.success', { defaultValue: 'Success' }),
          t('users.toast.subscriptionRegeneratedCopied', {
            defaultValue: 'New link for {{email}} was copied.',
            email: user.email
          })
        );
      } else {
        toast.success(
          t('common.success', { defaultValue: 'Success' }),
          t('users.toast.subscriptionRegenerated', {
            defaultValue: 'Token updated for {{email}}.',
            email: user.email
          })
        );
      }
      await refreshUsersAndSessions();
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.regenerateFailed', { defaultValue: 'Failed to regenerate subscription token' })
      );
    }
  };

  const handleQuickResetTraffic = async (user: User) => {
    if (!(await requestConfirm({
      title: t('users.actions.resetTrafficTitle', { defaultValue: 'Reset User Traffic' }),
      description: t('users.actions.resetTrafficDescription', {
        defaultValue: 'Reset traffic for {{email}}?',
        email: user.email
      }),
      confirmLabel: t('common.reset', { defaultValue: 'Reset' }),
      tone: 'primary'
    }))) {
      return;
    }

    try {
      await usersApi.resetTraffic(user.id);
      await refreshUsersAndSessions();
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.toast.trafficReset', { defaultValue: '{{email}} counters were reset.', email: user.email })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.resetFailed', { defaultValue: 'Failed to reset user traffic' })
      );
    }
  };

  const handleQuickExtendExpiry = async (user: User, days: number) => {
    try {
      await usersApi.extendExpiry(user.id, days);
      await refreshUsersAndSessions();
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.toast.expiryExtended', {
          defaultValue: '{{email}} extended by {{days}} day(s).',
          email: user.email,
          days
        })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.extendFailed', { defaultValue: 'Failed to extend user expiry' })
      );
    }
  };

  const handleQuickDisableUser = async (user: User) => {
    if (!(await requestConfirm({
      title: t('users.actions.disableTitle', { defaultValue: 'Disable User' }),
      description: t('users.actions.disableDescription', { defaultValue: 'Disable {{email}}?', email: user.email }),
      confirmLabel: t('common.disable', { defaultValue: 'Disable' }),
      tone: 'danger'
    }))) {
      return;
    }

    try {
      await usersApi.updateUser(user.id, { status: 'DISABLED' });
      await usersApi.disconnectUserSessions(user.id);
      await refreshUsersAndSessions();
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.toast.userDisabled', {
          defaultValue: '{{email}} is now disabled and disconnected.',
          email: user.email
        })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.disableFailed', { defaultValue: 'Failed to disable user' })
      );
    }
  };

  const handleQuickDisconnectSessions = async (user: User) => {
    if (!(await requestConfirm({
      title: t('users.actions.disconnectTitle', { defaultValue: 'Disconnect Sessions' }),
      description: t('users.actions.disconnectDescription', {
        defaultValue: 'Disconnect all active sessions for {{email}}?',
        email: user.email
      }),
      confirmLabel: t('common.disconnect', { defaultValue: 'Disconnect' }),
      tone: 'danger'
    }))) {
      return;
    }

    try {
      const response = await usersApi.disconnectUserSessions(user.id);
      await refreshUsersAndSessions();
      const summary = response?.data
        ? `${response.data.disconnectedDevices} device(s), ${response.data.disconnectedIps} IP(s)`
        : t('users.toast.sessionsDisconnectedFallback', { defaultValue: 'Active sessions disconnected.' });
      toast.success(t('common.success', { defaultValue: 'Success' }), summary);
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.toast.disconnectFailed', { defaultValue: 'Failed to disconnect active sessions' })
      );
    }
  };

  const handleCopySubscriptionLink = async (user: User) => {
    const link = `${window.location.origin}/sub/${user.subscriptionToken}?target=v2ray`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success(
        t('common.copied', { defaultValue: 'Copied' }),
        t('users.toast.subscriptionCopied', { defaultValue: 'Subscription link copied to clipboard.' })
      );
    } catch {
      toast.warning(
        t('users.toast.clipboardUnavailableTitle', { defaultValue: 'Clipboard unavailable' }),
        t('users.toast.clipboardUnavailableBody', {
          defaultValue: 'Copy failed. Use this link manually:\n{{link}}',
          link
        }),
        10000
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{t('users.title')}</h1>
          <p className="mt-1 text-sm text-muted">
            {t('users.subtitle', { defaultValue: 'Manage your VPN users and subscriptions' })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handleExport} disabled={users.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            {t('common.export', { defaultValue: 'Export CSV' })}
          </Button>
          <Button variant="secondary" onClick={() => setShowBulkModal(true)}>
            <UsersIcon className="mr-2 h-4 w-4" />
            {t('users.bulkProvision', { defaultValue: 'Bulk Provision' })}
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
          <p className="text-sm text-muted">{t('common.online', { defaultValue: 'Online' })}</p>
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
            {t('users.sessionStream', { defaultValue: 'Session stream' })}: {streamStatusLabel}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {streamLastSeenLabel}
            {userSessionsQuery.streamError ? ` • ${userSessionsQuery.streamError}` : ''}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">{t('users.limited', { defaultValue: 'Limited Users' })}</p>
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
                  placeholder={t('users.searchPlaceholder', { defaultValue: 'Search by email or UUID...' })}
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
              <option value="">{t('users.allStatus', { defaultValue: 'All Status' })}</option>
              <option value="ACTIVE">{t('status.active')}</option>
              <option value="LIMITED">{t('status.limited', { defaultValue: 'Limited' })}</option>
              <option value="DISABLED">{t('status.disabled', { defaultValue: 'Disabled' })}</option>
              <option value="EXPIRED">{t('status.expired', { defaultValue: 'Expired' })}</option>
            </select>

            <Button
              variant="secondary"
              onClick={() => {
                void autoRefresh.forceRefresh();
              }}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${usersQuery.isFetching || userSessionsQuery.isFetching ? 'animate-spin' : ''}`} />
              {t('common.refresh', { defaultValue: 'Refresh' })}
            </Button>
          </div>

          <div className="rounded-xl border border-line/70 bg-panel/40 p-3">
            <details className="group lg:hidden">
              <summary className="flex list-none items-center justify-between gap-3 rounded-xl px-2 py-2 text-left text-sm font-medium text-foreground transition hover:bg-panel/50 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0">
                  <p className="truncate">{t('common.advancedControls', { defaultValue: 'Advanced controls' })}</p>
                  <p className="mt-0.5 text-xs font-normal text-muted">
                    {t('autoRefresh.line', {
                      defaultValue: 'Auto refresh: {{status}} ({{seconds}}s)',
                      status: autoRefresh.statusLabel,
                      seconds: Math.ceil(autoRefresh.nextRunInMs / 1000)
                    })}
                  </p>
                </div>
                <ChevronDown className="h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-180" />
              </summary>

              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="min-w-[180px] flex-1 rounded-xl border border-line/80 bg-card/75 px-3 py-2 text-sm text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/35"
                    value={selectedViewId}
                    onChange={(event) => applySavedView(event.target.value)}
                  >
                    <option value="">{t('common.savedViews', { defaultValue: 'Saved views' })}</option>
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
                    {t('common.saveView', { defaultValue: 'Save View' })}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={removeSelectedView} disabled={!selectedViewId}>
                    {t('common.removeView', { defaultValue: 'Remove View' })}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-xl border border-line/70 bg-card/70 p-1">
                    {(['auto', 'table', 'cards'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setViewMode(mode)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === mode
                            ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white'
                            : 'text-muted hover:text-foreground'
                          }`}
                      >
                        {mode.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <Button size="sm" variant="ghost" onClick={autoRefresh.togglePaused}>
                    {autoRefresh.paused
                      ? t('autoRefresh.resume', { defaultValue: 'Resume Auto' })
                      : t('autoRefresh.pause', { defaultValue: 'Pause Auto' })}
                  </Button>
                </div>
              </div>
            </details>

            <div className="hidden items-center justify-between gap-3 lg:flex">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="min-w-[180px] rounded-xl border border-line/80 bg-card/75 px-3 py-2 text-sm text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/35"
                  value={selectedViewId}
                  onChange={(event) => applySavedView(event.target.value)}
                >
                  <option value="">{t('common.savedViews', { defaultValue: 'Saved views' })}</option>
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
                  {t('common.saveView', { defaultValue: 'Save View' })}
                </Button>
                <Button size="sm" variant="ghost" onClick={removeSelectedView} disabled={!selectedViewId}>
                  {t('common.removeView', { defaultValue: 'Remove View' })}
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl border border-line/70 bg-card/70 p-1">
                  {(['auto', 'table', 'cards'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setViewMode(mode)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === mode
                          ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white'
                          : 'text-muted hover:text-foreground'
                        }`}
                    >
                      {mode.toUpperCase()}
                    </button>
                  ))}
                </div>
                <Button size="sm" variant="ghost" onClick={autoRefresh.togglePaused}>
                  {autoRefresh.paused
                    ? t('autoRefresh.resume', { defaultValue: 'Resume Auto' })
                    : t('autoRefresh.pause', { defaultValue: 'Pause Auto' })}
                </Button>
                <span className="text-xs text-muted">
                  {t('autoRefresh.line', {
                    defaultValue: 'Auto refresh: {{status}} ({{seconds}}s)',
                    status: autoRefresh.statusLabel,
                    seconds: Math.ceil(autoRefresh.nextRunInMs / 1000)
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card padding={false}>
        {selectedUserIds.length > 0 ? (
          <div className="border-b border-line/70 bg-panel/50 px-4 py-3 sm:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="text-sm text-foreground">
                {t('users.selectedCount', { defaultValue: '{{count}} selected', count: selectedUserIds.length })}
                {selectedUsers.length > 0 ? ` (${selectedUsers.map((user) => user.email).slice(0, 2).join(', ')}${selectedUsers.length > 2 ? ', ...' : ''})` : ''}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <details className="group relative">
                  <summary
                    className="list-none"
                    onClick={(event) => {
                      if (isBulkMutating) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <Button size="sm" variant="secondary" disabled={isBulkMutating}>
                      <MoreVertical className="mr-2 h-4 w-4" />
                      {t('common.bulkActions', { defaultValue: 'Bulk actions' })}
                      <ChevronDown className="ml-2 h-4 w-4 text-muted transition-transform group-open:rotate-180" />
                    </Button>
                  </summary>

                  <div className="absolute right-0 z-20 mt-2 w-[min(92vw,22rem)] rounded-2xl border border-line/70 bg-panel/95 p-2 shadow-soft backdrop-blur">
                    <div className="space-y-1">
                      <button
                        type="button"
                        className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-foreground transition hover:bg-card/80 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={(event) => runBulkMenuAction(event, clearSelection)}
                        disabled={isBulkMutating}
                      >
                        {t('common.clearSelection', { defaultValue: 'Clear selection' })}
                      </button>

                      <button
                        type="button"
                        className="w-full rounded-xl px-3 py-2 text-left text-sm text-foreground transition hover:bg-card/80 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={(event) => runBulkMenuAction(event, () => void handleBulkResetTraffic())}
                        disabled={isBulkMutating}
                      >
                        Reset traffic
                      </button>

                      <button
                        type="button"
                        className="w-full rounded-xl px-3 py-2 text-left text-sm text-foreground transition hover:bg-card/80 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={(event) => runBulkMenuAction(event, () => void handleBulkExtendExpiry())}
                        disabled={isBulkMutating}
                      >
                        Extend expiry
                      </button>

                      <button
                        type="button"
                        className="w-full rounded-xl px-3 py-2 text-left text-sm text-foreground transition hover:bg-card/80 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={(event) => runBulkMenuAction(event, () => void handleBulkRotateKeys())}
                        disabled={isBulkMutating}
                      >
                        Rotate keys
                      </button>

                      {canRevokeUsers ? (
                        <button
                          type="button"
                          className="w-full rounded-xl px-3 py-2 text-left text-sm text-foreground transition hover:bg-card/80 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={(event) => runBulkMenuAction(event, () => void handleBulkRevokeKeys())}
                          disabled={isBulkMutating}
                        >
                          Revoke access
                        </button>
                      ) : null}

                      <button
                        type="button"
                        className="w-full rounded-xl px-3 py-2 text-left text-sm text-foreground transition hover:bg-card/80 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={(event) => runBulkMenuAction(event, () => void handleBulkApplyMyanmarPriority())}
                        disabled={isBulkMutating}
                      >
                        Myanmar priority reorder
                      </button>

                      <button
                        type="button"
                        className="w-full rounded-xl px-3 py-2 text-left text-sm text-foreground transition hover:bg-card/80 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={(event) => runBulkMenuAction(event, () => void handleBulkApplyQualityOrder())}
                        disabled={isBulkMutating}
                      >
                        {t('users.bulkQualityAutoTune', { defaultValue: 'Quality auto-tune reorder' })}
                      </button>
                    </div>

                    <div className="my-2 border-t border-line/60" />

                    {groups.length > 0 ? (
                      <div className="space-y-2 px-2 pb-1 pt-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Groups</p>
                        <select
                          value={selectedGroupId}
                          onChange={(event) => setSelectedGroupId(event.target.value)}
                          className="w-full rounded-xl border border-line/70 bg-card/80 px-3 py-2 text-sm text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/35"
                          disabled={isBulkMutating || groupsQuery.isFetching}
                        >
                          {groups.map((group) => (
                            <option key={group.id} value={group.id}>
                              {group.name}
                            </option>
                          ))}
                        </select>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={(event) => runBulkMenuAction(event, () => void handleBulkAssignToGroup())}
                            loading={assignGroupMutation.isPending}
                            disabled={isBulkMutating || !selectedGroupId}
                          >
                            Assign
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={(event) => runBulkMenuAction(event, () => void handleBulkMoveToGroup())}
                            loading={moveGroupUsersMutation.isPending}
                            disabled={isBulkMutating || !selectedGroupId}
                          >
                            Move
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={(event) => runBulkMenuAction(event, () => void handleBulkRemoveFromGroup())}
                            loading={removeGroupUsersMutation.isPending}
                            disabled={isBulkMutating || !selectedGroupId}
                          >
                            Remove
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={(event) => runBulkMenuAction(event, () => void handleBulkApplyGroupPolicy())}
                            loading={applyGroupPolicyMutation.isPending}
                            disabled={isBulkMutating || !selectedGroupId}
                          >
                            Apply Policy
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="px-2 pb-1 pt-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="w-full"
                          onClick={(event) => runBulkMenuAction(event, () => navigate('/groups'))}
                          disabled={groupsQuery.isFetching}
                        >
                          Create group
                        </Button>
                      </div>
                    )}

                    <div className="my-2 border-t border-line/60" />

                    <div className="space-y-2 px-2 pb-1 pt-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Status</p>
                      <select
                        value={bulkStatus}
                        onChange={(event) => setBulkStatus(event.target.value as UserStatus)}
                        className="w-full rounded-xl border border-line/70 bg-card/80 px-3 py-2 text-sm text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/35"
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
                        className="w-full"
                        onClick={(event) => runBulkMenuAction(event, () => void handleBulkUpdateStatus())}
                        loading={bulkUpdateStatusMutation.isPending}
                        disabled={isBulkMutating}
                      >
                        Apply status
                      </Button>
                    </div>

                    {canDeleteUsers ? (
                      <>
                        <div className="my-2 border-t border-line/60" />
                        <button
                          type="button"
                          className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-rose-200 transition hover:bg-rose-500/10 focus:outline-none focus:ring-2 focus:ring-rose-500/40 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={(event) => runBulkMenuAction(event, () => void handleBulkDelete())}
                          disabled={isBulkMutating}
                        >
                          Delete selected
                        </button>
                      </>
                    ) : null}
                  </div>
                </details>
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
            <p className="text-muted">{t('users.noUsers', { defaultValue: 'No users found' })}</p>
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
          onSuccess={(createdUser) => {
            setShowAddModal(false);
            void refreshUsersAndSessions();
            if (createdUser?.subscriptionToken) {
              const link = `${window.location.origin}/sub/${createdUser.subscriptionToken}?target=v2ray`;
              try {
                void navigator.clipboard.writeText(link).then(() => {
                  toast.success(
                    t('common.success', { defaultValue: 'Success' }),
                    t('users.toast.userCreatedCopied', {
                      defaultValue: 'User created. Subscription link copied to clipboard.',
                    })
                  );
                });
              } catch {
                toast.success(
                  t('common.success', { defaultValue: 'Success' }),
                  t('users.toast.userCreated', {
                    defaultValue: 'User created successfully.',
                  })
                );
              }
              setQuickQrUser(createdUser);
            }
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

      <MyanmarPriorityPreviewModal
        open={Boolean(bulkQualityPreviewState)}
        title={t('users.bulkQualityPreviewTitle', { defaultValue: 'Bulk Quality Auto-tune Preview' })}
        description={t('users.bulkQualityPreviewBody', { defaultValue: 'Reorder selected users by recent connect success, rejects, and reconnects.' })}
        summaryRows={[
          { label: 'Target Users', value: bulkQualityPreviewState?.targetUsers ?? 0 },
          { label: 'Would Reorder', value: bulkQualityPreviewState?.wouldUpdateUsers ?? 0 },
          { label: 'Telemetry Keys', value: bulkQualityPreviewState?.scoredKeys ?? 0 }
        ]}
        previewLines={bulkQualityPreviewState?.previewLines || []}
        confirmLabel={t('users.applyAutoTune', { defaultValue: 'Apply Auto-tune' })}
        loading={bulkQualityOrderMutation.isPending}
        disableConfirm={!bulkQualityPreviewState || bulkQualityPreviewState.wouldUpdateUsers === 0}
        onClose={() => {
          if (!bulkQualityOrderMutation.isPending) {
            setBulkQualityPreviewState(null);
          }
        }}
        onConfirm={() => {
          void handleConfirmBulkQualityOrder();
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
