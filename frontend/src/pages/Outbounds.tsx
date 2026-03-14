import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Edit, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import { Badge } from '../components/atoms/Badge';
import { Button } from '../components/atoms/Button';
import { Card } from '../components/atoms/Card';
import { ConfirmDialog } from '../components/organisms/ConfirmDialog';
import { useOutbounds, useCreateOutbound, useUpdateOutbound, useDeleteOutbound, useToggleOutbound } from '../hooks/useOutbounds';
import { useToast } from '../hooks/useToast';
import type { Outbound as OutboundType } from '../api/outbound';

type OutboundProtocol = 'FREEDOM' | 'BLACKHOLE' | 'SOCKS' | 'HTTP' | 'TROJAN' | 'VMESS' | 'VLESS' | 'SHADOWSOCKS';

const PROTOCOLS: OutboundProtocol[] = ['VLESS', 'VMESS', 'TROJAN', 'SHADOWSOCKS', 'SOCKS', 'HTTP', 'FREEDOM', 'BLACKHOLE'];

const protocolColor: Record<string, string> = {
  VLESS: 'text-blue-400',
  VMESS: 'text-purple-400',
  TROJAN: 'text-red-400',
  SHADOWSOCKS: 'text-yellow-400',
  SOCKS: 'text-green-400',
  HTTP: 'text-orange-400',
  FREEDOM: 'text-gray-400',
  BLACKHOLE: 'text-gray-600'
};

interface FormState {
  tag: string;
  protocol: OutboundProtocol;
  address: string;
  port: number;
  remark: string;
  priority: number;
  enabled: boolean;
  // Protocol-specific fields stored in settings
  uuid: string;
  alterId: number;
  encryption: string;
  flow: string;
  security: string;
  password: string;
  username: string;
  method: string;
}

const defaultForm: FormState = {
  tag: '',
  protocol: 'VLESS',
  address: '',
  port: 443,
  remark: '',
  priority: 100,
  enabled: true,
  uuid: '',
  alterId: 0,
  encryption: 'none',
  flow: '',
  security: 'auto',
  password: '',
  username: '',
  method: 'aes-256-gcm'
};

function formToPayload(form: FormState) {
  const settings: Record<string, unknown> = {};
  const protocol = form.protocol;

  switch (protocol) {
    case 'VMESS':
    case 'VLESS':
      settings.uuid = form.uuid;
      settings.alterId = form.alterId;
      settings.encryption = form.encryption;
      settings.flow = form.flow;
      settings.security = form.security;
      break;
    case 'TROJAN':
      settings.password = form.password;
      break;
    case 'SOCKS':
    case 'HTTP':
      if (form.username) {
        settings.username = form.username;
        settings.password = form.password;
      }
      break;
    case 'SHADOWSOCKS':
      settings.method = form.method;
      settings.password = form.password;
      break;
  }

  return {
    tag: form.tag,
    protocol: form.protocol,
    address: form.address,
    port: form.port,
    enabled: form.enabled,
    remark: form.remark || undefined,
    settings,
    priority: form.priority
  };
}

function outboundToForm(ob: OutboundType): FormState {
  const s = (ob.settings || {}) as Record<string, string | number>;
  return {
    tag: ob.tag,
    protocol: ob.protocol,
    address: ob.address,
    port: ob.port,
    remark: ob.remark || '',
    priority: ob.priority,
    enabled: ob.enabled,
    uuid: (s.uuid as string) || (s.id as string) || '',
    alterId: Number(s.alterId) || 0,
    encryption: (s.encryption as string) || 'none',
    flow: (s.flow as string) || '',
    security: (s.security as string) || 'auto',
    password: (s.password as string) || '',
    username: (s.username as string) || '',
    method: (s.method as string) || 'aes-256-gcm'
  };
}

const OutboundFormModal: React.FC<{
  open: boolean;
  onClose: () => void;
  editingOutbound?: OutboundType | null;
}> = ({ open, onClose, editingOutbound }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const createMutation = useCreateOutbound();
  const updateMutation = useUpdateOutbound();
  const isEdit = !!editingOutbound;

  const [form, setForm] = useState<FormState>(
    editingOutbound ? outboundToForm(editingOutbound) : { ...defaultForm }
  );

  React.useEffect(() => {
    if (open) {
      setForm(editingOutbound ? outboundToForm(editingOutbound) : { ...defaultForm });
    }
  }, [open, editingOutbound]);

  const update = (key: keyof FormState, value: string | number | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = formToPayload(form);
      if (isEdit && editingOutbound) {
        await updateMutation.mutateAsync({ id: editingOutbound.id, data: payload });
        toast.success('Outbound updated');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('Outbound created');
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed';
      toast.error(msg);
    }
  };

  if (!open) return null;

  const isPending = createMutation.isPending || updateMutation.isPending;
  const needsAddress = !['FREEDOM', 'BLACKHOLE'].includes(form.protocol);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-surface p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold text-primary">
          {isEdit ? 'Edit Outbound' : 'Create Outbound'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tag & Protocol */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-secondary">Tag *</span>
              <input
                className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
                value={form.tag}
                onChange={(e) => update('tag', e.target.value)}
                required
                disabled={isEdit}
                placeholder="my-upstream"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-secondary">Protocol *</span>
              <select
                className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
                value={form.protocol}
                onChange={(e) => update('protocol', e.target.value)}
              >
                {PROTOCOLS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>

          {/* Address & Port */}
          {needsAddress && (
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-2 block">
                <span className="mb-1 block text-xs text-secondary">Address *</span>
                <input
                  className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
                  value={form.address}
                  onChange={(e) => update('address', e.target.value)}
                  required
                  placeholder="example.com"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-secondary">Port *</span>
                <input
                  type="number"
                  className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
                  value={form.port}
                  onChange={(e) => update('port', parseInt(e.target.value) || 0)}
                  required
                  min={1}
                  max={65535}
                />
              </label>
            </div>
          )}

          {/* Protocol-specific fields */}
          {(form.protocol === 'VLESS' || form.protocol === 'VMESS') && (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs text-secondary">UUID *</span>
                <input
                  className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
                  value={form.uuid}
                  onChange={(e) => update('uuid', e.target.value)}
                  required
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              </label>
              {form.protocol === 'VLESS' && (
                <label className="block">
                  <span className="mb-1 block text-xs text-secondary">Flow</span>
                  <select
                    className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
                    value={form.flow}
                    onChange={(e) => update('flow', e.target.value)}
                  >
                    <option value="">None</option>
                    <option value="xtls-rprx-vision">xtls-rprx-vision</option>
                  </select>
                </label>
              )}
              {form.protocol === 'VMESS' && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs text-secondary">Security</span>
                    <select
                      className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
                      value={form.security}
                      onChange={(e) => update('security', e.target.value)}
                    >
                      {['auto', 'aes-128-gcm', 'chacha20-poly1305', 'none', 'zero'].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-secondary">Alter ID</span>
                    <input
                      type="number"
                      className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
                      value={form.alterId}
                      onChange={(e) => update('alterId', parseInt(e.target.value) || 0)}
                      min={0}
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {form.protocol === 'TROJAN' && (
            <label className="block">
              <span className="mb-1 block text-xs text-secondary">Password *</span>
              <input
                type="password"
                className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                required
              />
            </label>
          )}

          {form.protocol === 'SHADOWSOCKS' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-secondary">Method</span>
                <select
                  className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
                  value={form.method}
                  onChange={(e) => update('method', e.target.value)}
                >
                  {['aes-256-gcm', 'aes-128-gcm', 'chacha20-poly1305', '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305'].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-secondary">Password *</span>
                <input
                  type="password"
                  className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
                  value={form.password}
                  onChange={(e) => update('password', e.target.value)}
                  required
                />
              </label>
            </div>
          )}

          {(form.protocol === 'SOCKS' || form.protocol === 'HTTP') && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-secondary">Username</span>
                <input
                  className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
                  value={form.username}
                  onChange={(e) => update('username', e.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-secondary">Password</span>
                <input
                  type="password"
                  className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
                  value={form.password}
                  onChange={(e) => update('password', e.target.value)}
                  placeholder="Optional"
                />
              </label>
            </div>
          )}

          {/* Remark & Priority */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-secondary">Remark</span>
              <input
                className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
                value={form.remark}
                onChange={(e) => update('remark', e.target.value)}
                placeholder="Optional note"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-secondary">Priority</span>
              <input
                type="number"
                className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
                value={form.priority}
                onChange={(e) => update('priority', parseInt(e.target.value) || 100)}
                min={1}
                max={9999}
              />
            </label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? '...' : isEdit ? t('common.save', { defaultValue: 'Save' }) : t('common.create', { defaultValue: 'Create' })}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const Outbounds: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, isLoading, error } = useOutbounds();
  const deleteMutation = useDeleteOutbound();
  const toggleMutation = useToggleOutbound();

  const [formOpen, setFormOpen] = useState(false);
  const [editingOutbound, setEditingOutbound] = useState<OutboundType | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<OutboundType | null>(null);

  const outbounds = data?.items ?? [];

  const handleEdit = (ob: OutboundType) => {
    setEditingOutbound(ob);
    setFormOpen(true);
  };

  const handleCreate = () => {
    setEditingOutbound(null);
    setFormOpen(true);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteMutation.mutateAsync(confirmDelete.id);
      toast.success('Outbound deleted');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      toast.error(msg);
    }
    setConfirmDelete(null);
  };

  const handleToggle = async (ob: OutboundType) => {
    try {
      await toggleMutation.mutateAsync(ob.id);
      toast.success(`Outbound ${ob.enabled ? 'disabled' : 'enabled'}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Toggle failed';
      toast.error(msg);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">
            {t('outbounds.title', { defaultValue: 'Outbounds' })}
          </h1>
          <p className="text-sm text-secondary">
            {t('outbounds.subtitle', { defaultValue: 'Manage upstream relay and chain proxy outbounds' })}
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t('outbounds.create', { defaultValue: 'Add Outbound' })}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <Card className="border-red-500/20 bg-red-500/5 p-4">
          <p className="text-sm text-red-400">{(error as Error).message}</p>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-line/80 border-t-brand-500" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && outbounds.length === 0 && (
        <Card className="flex flex-col items-center justify-center py-16">
          <p className="mb-2 text-lg font-medium text-secondary">
            {t('outbounds.empty', { defaultValue: 'No outbounds configured' })}
          </p>
          <p className="mb-4 text-sm text-tertiary">
            {t('outbounds.emptyDesc', { defaultValue: 'Add an upstream outbound to relay traffic through another server.' })}
          </p>
          <Button onClick={handleCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('outbounds.create', { defaultValue: 'Add Outbound' })}
          </Button>
        </Card>
      )}

      {/* Table */}
      {!isLoading && outbounds.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wider text-secondary">
                  <th className="px-4 py-3">Tag</th>
                  <th className="px-4 py-3">Protocol</th>
                  <th className="px-4 py-3">Destination</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {outbounds.map((ob) => (
                  <tr key={ob.id} className="transition-colors hover:bg-surface-hover">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-primary">{ob.tag}</span>
                        {ob.remark && <span className="text-xs text-tertiary">{ob.remark}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-mono font-medium ${protocolColor[ob.protocol] || 'text-secondary'}`}>
                        {ob.protocol}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-secondary font-mono">
                      {['FREEDOM', 'BLACKHOLE'].includes(ob.protocol) ? (
                        <span className="text-tertiary italic">N/A</span>
                      ) : (
                        `${ob.address}:${ob.port}`
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-secondary">{ob.priority}</td>
                    <td className="px-4 py-3">
                      <Badge variant={ob.enabled ? 'success' : 'secondary'}>
                        {ob.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleToggle(ob)}
                          className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-surface-active hover:text-primary"
                          title={ob.enabled ? 'Disable' : 'Enable'}
                        >
                          {ob.enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => handleEdit(ob)}
                          className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-surface-active hover:text-primary"
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(ob)}
                          className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-red-500/10 hover:text-red-400"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Form Modal */}
      <OutboundFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editingOutbound={editingOutbound}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!confirmDelete}
        title={t('outbounds.deleteTitle', { defaultValue: 'Delete Outbound' })}
        description={t('outbounds.deleteMessage', {
          defaultValue: `Are you sure you want to delete outbound "${confirmDelete?.tag}"?`,
          tag: confirmDelete?.tag
        })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
        tone="danger"
      />
    </div>
  );
};
