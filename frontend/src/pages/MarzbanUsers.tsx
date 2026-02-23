import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, Trash2, Edit, RefreshCw, Link2, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

import { getUsers, deleteUser, resetTraffic, revokeSubscription } from '../lib/api/users';
import type { User } from '../types/marzban';
import { Card } from '../components/atoms/Card';
import { Button } from '../components/atoms/Button';
import { Input } from '../components/atoms/Input';
import { formatBytes } from '../utils/formatters';
import { useToast } from '../hooks/useToast';
import { Skeleton } from '../components/atoms/Skeleton';
import { copyTextToClipboard } from '../utils/clipboard';

// We inline form and QR modals here for simplicity within the scope of the rewrite.
// In a larger refactor, these would be separate component files.
import { MarzbanUserFormModal } from '../components/organisms/MarzbanUserFormModal';
import { ConfirmDialog } from '../components/organisms/ConfirmDialog';

export const Users: React.FC = () => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [qrUser, setQrUser] = useState<User | null>(null);
  const [formUser, setFormUser] = useState<User | null | 'new'>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ userId: string; action: 'delete' | 'reset' | 'revoke' } | null>(null);

  const queryClient = useQueryClient();
  const toast = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['marzban-users', search, statusFilter],
    queryFn: () => getUsers({ search, status: statusFilter }),
    refetchInterval: 30000 // Fallback polling, though socket.io will drive real-time triggers
  });

  const users = data?.users || [];

  const deleteMutation = useMutation({
    mutationFn: (username: string) => deleteUser(username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marzban-users'] });
      toast.success('Success', 'User deleted successfully');
      setConfirmDialog(null);
    }
  });

  const resetMutation = useMutation({
    mutationFn: (username: string) => resetTraffic(username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marzban-users'] });
      toast.success('Success', 'Traffic reset successfully');
      setConfirmDialog(null);
    }
  });

  const revokeMutation = useMutation({
    mutationFn: (username: string) => revokeSubscription(username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marzban-users'] });
      toast.success('Success', 'Subscription revoked and regenerated');
      setConfirmDialog(null);
    }
  });

  const handleActionConfirm = () => {
    if (!confirmDialog) return;

    if (confirmDialog.action === 'delete') deleteMutation.mutate(confirmDialog.userId);
    if (confirmDialog.action === 'reset') resetMutation.mutate(confirmDialog.userId);
    if (confirmDialog.action === 'revoke') revokeMutation.mutate(confirmDialog.userId);
  };

  const copyUrl = (url: string) => {
    copyTextToClipboard(url);
    toast.success('Copied', 'Subscription URL copied to clipboard');
  };

  const getStatusBadge = (status: User['status']) => {
    const colors = {
      active: 'bg-emerald-500/15 text-emerald-500',
      disabled: 'bg-rose-500/15 text-rose-500',
      limited: 'bg-amber-500/15 text-amber-500',
      expired: 'bg-fuchsia-500/15 text-fuchsia-500',
      on_hold: 'bg-gray-500/15 text-gray-500'
    };
    return (
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${colors[status] || colors.on_hold}`}>
        {status}
      </span>
    );
  };

  const formatExpiry = (expire: number | null) => {
    if (!expire) return 'Never';
    return new Date(expire * 1000).toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Marzban Users</h1>
          <p className="mt-1 text-sm text-muted">Manage proxied proxy users directly down to the Native Marzban UI</p>
        </div>
        <Button onClick={() => setFormUser('new')} className="gap-2">
          <Plus className="h-4 w-4" />
          Add User
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              placeholder="Search by username..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="rounded-md border border-line bg-panel px-3 py-2.5 text-sm text-foreground focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="limited">Limited</option>
            <option value="expired">Expired</option>
            <option value="on_hold">On Hold</option>
          </select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-panel/50 text-xs uppercase text-muted">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-medium">Username</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">Status</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">Used / Limit</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">Expiry</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-20 float-right" /></td>
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    No users found matching your filters.
                  </td>
                </tr>
              ) : (
                users.map((user: User) => (
                  <tr key={user.username} className="transition-colors hover:bg-panel/30">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-foreground">
                      {user.username}
                      {user.online_at && (
                        <span className="ml-2 inline-flex items-center gap-1.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-emerald-500">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                          </span>
                          ONLINE
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{getStatusBadge(user.status)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      <span className="text-foreground">{formatBytes(user.used_traffic)}</span> / {user.data_limit ? formatBytes(user.data_limit) : '∞'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatExpiry(user.expire)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" className="p-2" title="Edit" onClick={() => setFormUser(user)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" className="p-2" title="Copy Subscription" onClick={() => copyUrl(user.subscription_url)}>
                          <Link2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" className="p-2" title="View QR" onClick={() => setQrUser(user)}>
                          <QrCode className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" className="p-2" title="Reset Traffic" onClick={() => setConfirmDialog({ userId: user.username, action: 'reset' })}>
                          <RefreshCw className="h-4 w-4 text-emerald-500" />
                        </Button>
                        <Button variant="ghost" className="p-2" title="Delete" onClick={() => setConfirmDialog({ userId: user.username, action: 'delete' })}>
                          <Trash2 className="h-4 w-4 text-rose-500" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Embedded Modals below logic flow */}
      {confirmDialog && (
        <ConfirmDialog
          title={
            confirmDialog.action === 'delete' ? 'Delete User' :
              confirmDialog.action === 'reset' ? 'Reset Traffic' : 'Revoke Subscription'
          }
          description={`Are you sure you want to ${confirmDialog.action} the user "${confirmDialog.userId}"?`}
          open={true}
          onCancel={() => setConfirmDialog(null)}
          onConfirm={handleActionConfirm}
          tone={confirmDialog.action === 'delete' ? 'danger' : 'primary'}
          confirmLabel={confirmDialog.action === 'delete' ? 'Delete' : 'Confirm'}
        />
      )}

      {qrUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm overflow-hidden border-line">
            <div className="flex items-center justify-between border-b border-line bg-panel p-4">
              <h3 className="font-semibold text-foreground">Scan QR Code</h3>
              <button onClick={() => setQrUser(null)} className="text-muted hover:text-foreground">✕</button>
            </div>
            <div className="p-6 text-center">
              <div className="inline-block rounded-xl bg-white p-4">
                <QRCodeSVG value={qrUser.subscription_url} size={200} />
              </div>
              <p className="mt-4 text-sm font-medium text-foreground">{qrUser.username}</p>
              <input
                readOnly
                value={qrUser.subscription_url}
                className="mt-4 w-full rounded-md border border-line bg-panel px-3 py-2 text-xs text-muted"
                onClick={e => e.currentTarget.select()}
              />
              <Button
                variant="secondary"
                className="mt-4 w-full"
                onClick={() => setConfirmDialog({ userId: qrUser.username, action: 'revoke' })}
              >
                Revoke & Regenerate Link
              </Button>
            </div>
          </Card>
        </div>
      )}

      {formUser && (
        <MarzbanUserFormModal
          user={formUser === 'new' ? null : formUser}
          isOpen={true}
          onClose={() => setFormUser(null)}
        />
      )}
    </div>
  );
};

export const UsersPage = Users;
