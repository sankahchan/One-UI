import { useEffect, useMemo, useState } from 'react';
import {
  Clock3,
  Layers3,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UsersRound,
  Wifi
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import { Badge } from '../components/atoms/Badge';
import { Button } from '../components/atoms/Button';
import { Card } from '../components/atoms/Card';
import { Input } from '../components/atoms/Input';
import { ConfirmDialog } from '../components/organisms/ConfirmDialog';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useToast } from '../hooks/useToast';
import {
  useApplyGroupPolicyTemplate,
  useCreateGroup,
  useCreateGroupPolicySchedule,
  useCreateGroupPolicyTemplate,
  useDeleteGroup,
  useDeleteGroupPolicySchedule,
  useDeleteGroupPolicyTemplate,
  useGroupPolicyRollouts,
  useGroupPolicySchedules,
  useGroupPolicyTemplates,
  useGroups,
  useRunGroupPolicySchedule,
  useUpdateGroup,
  useUpdateGroupPolicySchedule,
  useUpdateGroupPolicyTemplate
} from '../hooks/useGroups';
import { useInbounds } from '../hooks/useInbounds';
import { useUsers } from '../hooks/useUsers';
import type {
  Group,
  GroupPolicyRollout,
  GroupPolicySchedule,
  GroupPolicyTemplate,
  Inbound,
  User
} from '../types';

type GroupTab = 'groups' | 'templates' | 'schedules' | 'rollouts';
type PendingDeleteTarget =
  | { type: 'group'; id: number; name: string }
  | { type: 'template'; id: number; name: string }
  | { type: 'schedule'; id: number; name: string }
  | null;

type GroupEditorValues = {
  name: string;
  remark: string;
  isDisabled: boolean;
  dataLimit: number | null;
  expiryDays: number | null;
  ipLimit: number | null;
  status: User['status'] | null;
  trafficResetPeriod: 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | null;
  trafficResetDay: number | null;
  userIds: number[];
  inboundIds: number[];
};

type TemplateEditorValues = {
  name: string;
  description: string;
  isDefault: boolean;
  dataLimit: number | null;
  expiryDays: number | null;
  ipLimit: number | null;
  status: User['status'] | null;
  trafficResetPeriod: 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | null;
  trafficResetDay: number | null;
};

type ScheduleEditorValues = {
  name: string;
  groupId: number;
  templateId: number | null;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  dryRun: boolean;
  targetUserIds: number[];
};

type UserOption = Pick<User, 'id' | 'email' | 'status'>;
type InboundOption = Pick<Inbound, 'id' | 'tag' | 'protocol' | 'port' | 'enabled' | 'remark'>;

type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

function extractPagination(payload?: { meta?: Partial<PaginationMeta>; pagination?: Partial<PaginationMeta> }) {
  const meta = payload?.meta || payload?.pagination;
  if (!meta) {
    return undefined;
  }

  if (
    typeof meta.page !== 'number'
    || typeof meta.limit !== 'number'
    || typeof meta.total !== 'number'
    || typeof meta.totalPages !== 'number'
  ) {
    return undefined;
  }

  return meta as PaginationMeta;
}

function toggleSelection(currentValues: number[], id: number) {
  if (currentValues.includes(id)) {
    return currentValues.filter((entry) => entry !== id);
  }

  return [...currentValues, id];
}

function toNumericInputValue(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return '';
  }

  return String(parsed);
}

function parseNullableNumber(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function parseNullableInt(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed)) {
    return null;
  }

  return parsed;
}

function parseUserIdsCsv(input: string) {
  return Array.from(
    new Set(
      input
        .split(',')
        .map((entry) => Number.parseInt(entry.trim(), 10))
        .filter((entry) => Number.isInteger(entry) && entry > 0)
    )
  );
}

type TranslateFn = (key: string, options?: any) => string;

function buildPolicyChips(target: {
  dataLimit?: number | string | null;
  expiryDays?: number | null;
  ipLimit?: number | null;
  status?: User['status'] | null;
  trafficResetPeriod?: 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | null;
  trafficResetDay?: number | null;
}, t: TranslateFn) {
  const chips: string[] = [];

  if (target.dataLimit !== null && target.dataLimit !== undefined) {
    chips.push(
      t('groups.chips.dataLimit', {
        defaultValue: 'Limit: {{value}} GB',
        value: target.dataLimit
      })
    );
  }
  if (target.expiryDays !== null && target.expiryDays !== undefined) {
    chips.push(
      t('groups.chips.expiryDays', {
        defaultValue: 'Expiry: {{value}}d',
        value: target.expiryDays
      })
    );
  }
  if (target.ipLimit !== null && target.ipLimit !== undefined) {
    chips.push(
      t('groups.chips.ipLimit', {
        defaultValue: 'IP: {{value}}',
        value: target.ipLimit
      })
    );
  }
  if (target.status) {
    const statusKey = `status.${String(target.status).toLowerCase()}`;
    chips.push(
      t('groups.chips.status', {
        defaultValue: 'Status: {{value}}',
        value: t(statusKey, { defaultValue: String(target.status) })
      })
    );
  }
  if (target.trafficResetPeriod) {
    const periodKey = `groups.resetPeriod.${String(target.trafficResetPeriod).toLowerCase()}`;
    const periodLabel = t(periodKey, { defaultValue: String(target.trafficResetPeriod) });

    if (target.trafficResetDay) {
      chips.push(
        t('groups.chips.resetWithDay', {
          defaultValue: 'Reset: {{period}}@{{day}}',
          period: periodLabel,
          day: target.trafficResetDay
        })
      );
    } else {
      chips.push(
        t('groups.chips.reset', {
          defaultValue: 'Reset: {{period}}',
          period: periodLabel
        })
      );
    }
  }

  return chips;
}

type GroupEditorModalProps = {
  group: Group | null;
  users: UserOption[];
  inbounds: InboundOption[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: GroupEditorValues) => Promise<void>;
};

function GroupEditorModal({ group, users, inbounds, saving, onClose, onSubmit }: GroupEditorModalProps) {
  const toast = useToast();
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [remark, setRemark] = useState('');
  const [isDisabled, setIsDisabled] = useState(false);
  const [dataLimit, setDataLimit] = useState('');
  const [expiryDays, setExpiryDays] = useState('');
  const [ipLimit, setIpLimit] = useState('');
  const [status, setStatus] = useState<User['status'] | ''>('');
  const [trafficResetPeriod, setTrafficResetPeriod] = useState<'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | ''>('');
  const [trafficResetDay, setTrafficResetDay] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [selectedInboundIds, setSelectedInboundIds] = useState<number[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [inboundSearch, setInboundSearch] = useState('');

  useEffect(() => {
    setName(group?.name || '');
    setRemark(group?.remark || '');
    setIsDisabled(Boolean(group?.isDisabled));
    setDataLimit(toNumericInputValue(group?.dataLimit));
    setExpiryDays(toNumericInputValue(group?.expiryDays));
    setIpLimit(toNumericInputValue(group?.ipLimit));
    setStatus(group?.status || '');
    setTrafficResetPeriod(group?.trafficResetPeriod || '');
    setTrafficResetDay(toNumericInputValue(group?.trafficResetDay));
    setSelectedUserIds(group?.users?.map((entry) => entry.userId) || []);
    setSelectedInboundIds(group?.inbounds?.map((entry) => entry.inboundId) || []);
    setUserSearch('');
    setInboundSearch('');
  }, [group]);

  const filteredUsers = useMemo(() => {
    const keyword = userSearch.trim().toLowerCase();
    if (!keyword) {
      return users;
    }

    return users.filter((user) => user.email.toLowerCase().includes(keyword));
  }, [users, userSearch]);

  const filteredInbounds = useMemo(() => {
    const keyword = inboundSearch.trim().toLowerCase();
    if (!keyword) {
      return inbounds;
    }

    return inbounds.filter((inbound) => {
      const target = [inbound.tag, inbound.remark || '', inbound.protocol, String(inbound.port)].join(' ').toLowerCase();
      return target.includes(keyword);
    });
  }, [inbounds, inboundSearch]);

  const handleSave = async () => {
    const safeName = name.trim();
    if (!safeName) {
      toast.error(
        t('common.validationFailed', { defaultValue: 'Validation failed' }),
        t('groups.editor.nameRequired', { defaultValue: 'Group name is required.' })
      );
      return;
    }

    await onSubmit({
      name: safeName,
      remark: remark.trim(),
      isDisabled,
      dataLimit: parseNullableNumber(dataLimit),
      expiryDays: parseNullableInt(expiryDays),
      ipLimit: parseNullableInt(ipLimit),
      status: status || null,
      trafficResetPeriod: trafficResetPeriod || null,
      trafficResetDay: parseNullableInt(trafficResetDay),
      userIds: selectedUserIds,
      inboundIds: selectedInboundIds
    });
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="glass-panel max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-line/70 px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              {group
                ? t('groups.editor.editTitle', { defaultValue: 'Edit Group' })
                : t('groups.editor.createTitle', { defaultValue: 'Create Group' })}
            </h2>
            <p className="text-sm text-muted">
              {t('groups.editor.subtitle', { defaultValue: 'Reusable user, inbound and policy bundle.' })}
            </p>
          </div>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close', { defaultValue: 'Close' })}
          </Button>
        </div>

        <div className="max-h-[calc(90vh-10rem)] space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label={t('groups.editor.nameLabel', { defaultValue: 'Group Name *' })}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('groups.editor.namePlaceholder', { defaultValue: 'Premium users' })}
            />
            <Input
              label={t('groups.editor.remarkLabel', { defaultValue: 'Remark' })}
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              placeholder={t('groups.editor.remarkPlaceholder', { defaultValue: 'Optional note' })}
            />
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={isDisabled}
              onChange={(event) => setIsDisabled(event.target.checked)}
              className="h-4 w-4 rounded border-line bg-card text-brand-500"
            />
            {t('groups.editor.disableGroup', { defaultValue: 'Disable this group' })}
          </label>

          <div className="rounded-xl border border-line/70 bg-panel/55 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted">
              {t('groups.editor.policyOverridesTitle', { defaultValue: 'Policy Overrides' })}
            </h3>
            <p className="mt-1 text-xs text-muted">
              {t('groups.editor.policyOverridesHint', { defaultValue: 'Leave empty to inherit each user policy.' })}
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Input
                label={t('groups.editor.dataLimitLabel', { defaultValue: 'Data Limit (GB)' })}
                type="number"
                min={0}
                value={dataLimit}
                onChange={(event) => setDataLimit(event.target.value)}
              />
              <Input
                label={t('users.expiryDays', { defaultValue: 'Expiry Days' })}
                type="number"
                min={1}
                value={expiryDays}
                onChange={(event) => setExpiryDays(event.target.value)}
              />
              <Input
                label={t('groups.editor.ipLimitLabel', { defaultValue: 'IP Limit (0 = unlimited)' })}
                type="number"
                min={0}
                value={ipLimit}
                onChange={(event) => setIpLimit(event.target.value)}
              />
              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">
                  {t('groups.editor.statusOverride', { defaultValue: 'Status Override' })}
                </label>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as User['status'] | '')}
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <option value="">{t('groups.editor.noOverride', { defaultValue: 'No override' })}</option>
                  <option value="ACTIVE">{t('status.active', { defaultValue: 'Active' })}</option>
                  <option value="LIMITED">{t('status.limited', { defaultValue: 'Limited' })}</option>
                  <option value="EXPIRED">{t('status.expired', { defaultValue: 'Expired' })}</option>
                  <option value="DISABLED">{t('status.disabled', { defaultValue: 'Disabled' })}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">
                  {t('groups.editor.trafficResetPeriod', { defaultValue: 'Traffic Reset Period' })}
                </label>
                <select
                  value={trafficResetPeriod}
                  onChange={(event) => setTrafficResetPeriod(event.target.value as 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | '')}
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <option value="">{t('groups.editor.noOverride', { defaultValue: 'No override' })}</option>
                  <option value="NEVER">{t('groups.resetPeriod.never', { defaultValue: 'NEVER' })}</option>
                  <option value="DAILY">{t('groups.resetPeriod.daily', { defaultValue: 'DAILY' })}</option>
                  <option value="WEEKLY">{t('groups.resetPeriod.weekly', { defaultValue: 'WEEKLY' })}</option>
                  <option value="MONTHLY">{t('groups.resetPeriod.monthly', { defaultValue: 'MONTHLY' })}</option>
                </select>
              </div>
              <Input
                label={t('groups.editor.trafficResetDay', { defaultValue: 'Traffic Reset Day' })}
                type="number"
                min={1}
                max={31}
                value={trafficResetDay}
                onChange={(event) => setTrafficResetDay(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-line/70 bg-panel/55 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {t('groups.editor.usersTitle', { defaultValue: 'Users ({{count}})', count: selectedUserIds.length })}
                </h3>
                <Input
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
                  placeholder={t('groups.editor.filterUsers', { defaultValue: 'Filter users' })}
                  className="max-w-[12rem] py-2 text-xs"
                />
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {filteredUsers.length === 0 ? (
                  <p className="text-sm text-muted">{t('groups.editor.noUsers', { defaultValue: 'No users found.' })}</p>
                ) : filteredUsers.map((user) => (
                  <label key={user.id} className="flex cursor-pointer items-center justify-between rounded-lg border border-line/60 bg-card/65 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{user.email}</p>
                      <p className="text-xs text-muted">{user.status}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={selectedUserIds.includes(user.id)}
                      onChange={() => setSelectedUserIds((prev) => toggleSelection(prev, user.id))}
                      className="h-4 w-4 rounded border-line bg-card text-brand-500"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-line/70 bg-panel/55 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {t('groups.editor.inboundsTitle', { defaultValue: 'Inbounds ({{count}})', count: selectedInboundIds.length })}
                </h3>
                <Input
                  value={inboundSearch}
                  onChange={(event) => setInboundSearch(event.target.value)}
                  placeholder={t('groups.editor.filterInbounds', { defaultValue: 'Filter inbounds' })}
                  className="max-w-[12rem] py-2 text-xs"
                />
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {filteredInbounds.length === 0 ? (
                  <p className="text-sm text-muted">{t('groups.editor.noInbounds', { defaultValue: 'No inbounds found.' })}</p>
                ) : filteredInbounds.map((inbound) => (
                  <label key={inbound.id} className="flex cursor-pointer items-center justify-between rounded-lg border border-line/60 bg-card/65 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{inbound.protocol} • {inbound.port}</p>
                      <p className="truncate text-xs text-muted">{inbound.remark || inbound.tag}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={selectedInboundIds.includes(inbound.id)}
                      onChange={() => setSelectedInboundIds((prev) => toggleSelection(prev, inbound.id))}
                      className="h-4 w-4 rounded border-line bg-card text-brand-500"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line/70 px-6 py-4">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            {group
              ? t('groups.editor.saveChanges', { defaultValue: 'Save Changes' })
              : t('groups.editor.createCta', { defaultValue: 'Create Group' })}
          </Button>
        </div>
      </div>
    </div>
  );
}

type TemplateEditorModalProps = {
  template: GroupPolicyTemplate | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: TemplateEditorValues) => Promise<void>;
};

function TemplateEditorModal({ template, saving, onClose, onSubmit }: TemplateEditorModalProps) {
  const toast = useToast();
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [dataLimit, setDataLimit] = useState('');
  const [expiryDays, setExpiryDays] = useState('');
  const [ipLimit, setIpLimit] = useState('');
  const [status, setStatus] = useState<User['status'] | ''>('');
  const [trafficResetPeriod, setTrafficResetPeriod] = useState<'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | ''>('');
  const [trafficResetDay, setTrafficResetDay] = useState('');

  useEffect(() => {
    setName(template?.name || '');
    setDescription(template?.description || '');
    setIsDefault(Boolean(template?.isDefault));
    setDataLimit(toNumericInputValue(template?.dataLimit));
    setExpiryDays(toNumericInputValue(template?.expiryDays));
    setIpLimit(toNumericInputValue(template?.ipLimit));
    setStatus(template?.status || '');
    setTrafficResetPeriod(template?.trafficResetPeriod || '');
    setTrafficResetDay(toNumericInputValue(template?.trafficResetDay));
  }, [template]);

  const handleSave = async () => {
    const safeName = name.trim();
    if (!safeName) {
      toast.error(
        t('common.validationFailed', { defaultValue: 'Validation failed' }),
        t('groups.templates.editor.nameRequired', { defaultValue: 'Template name is required.' })
      );
      return;
    }

    await onSubmit({
      name: safeName,
      description: description.trim(),
      isDefault,
      dataLimit: parseNullableNumber(dataLimit),
      expiryDays: parseNullableInt(expiryDays),
      ipLimit: parseNullableInt(ipLimit),
      status: status || null,
      trafficResetPeriod: trafficResetPeriod || null,
      trafficResetDay: parseNullableInt(trafficResetDay)
    });
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-2xl rounded-2xl">
        <div className="border-b border-line/70 px-6 py-4">
          <h2 className="text-xl font-semibold text-foreground">
            {template
              ? t('groups.templates.editor.editTitle', { defaultValue: 'Edit Policy Template' })
              : t('groups.templates.editor.createTitle', { defaultValue: 'Create Policy Template' })}
          </h2>
          <p className="text-sm text-muted">
            {t('groups.templates.editor.subtitle', { defaultValue: 'Reusable policy overrides for multiple groups.' })}
          </p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <Input
            label={t('groups.templates.editor.nameLabel', { defaultValue: 'Template Name *' })}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('groups.templates.editor.namePlaceholder', { defaultValue: 'Monthly 50GB Standard' })}
          />
          <Input
            label={t('groups.templates.editor.descriptionLabel', { defaultValue: 'Description' })}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('groups.templates.editor.descriptionPlaceholder', { defaultValue: 'Optional details' })}
          />

          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
              className="h-4 w-4 rounded border-line bg-card text-brand-500"
            />
            {t('groups.templates.editor.defaultToggle', { defaultValue: 'Mark as default template' })}
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <Input
              label={t('groups.editor.dataLimitLabel', { defaultValue: 'Data Limit (GB)' })}
              type="number"
              min={0}
              value={dataLimit}
              onChange={(event) => setDataLimit(event.target.value)}
            />
            <Input
              label={t('users.expiryDays', { defaultValue: 'Expiry Days' })}
              type="number"
              min={1}
              value={expiryDays}
              onChange={(event) => setExpiryDays(event.target.value)}
            />
            <Input
              label={t('groups.editor.ipLimitLabel', { defaultValue: 'IP Limit (0 = unlimited)' })}
              type="number"
              min={0}
              value={ipLimit}
              onChange={(event) => setIpLimit(event.target.value)}
            />

            <div className="space-y-1.5">
              <label className="ml-1 block text-sm font-medium text-muted">
                {t('groups.editor.statusOverride', { defaultValue: 'Status Override' })}
              </label>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as User['status'] | '')}
                className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
              >
                <option value="">{t('groups.editor.noOverride', { defaultValue: 'No override' })}</option>
                <option value="ACTIVE">{t('status.active', { defaultValue: 'Active' })}</option>
                <option value="LIMITED">{t('status.limited', { defaultValue: 'Limited' })}</option>
                <option value="EXPIRED">{t('status.expired', { defaultValue: 'Expired' })}</option>
                <option value="DISABLED">{t('status.disabled', { defaultValue: 'Disabled' })}</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="ml-1 block text-sm font-medium text-muted">
                {t('groups.editor.trafficResetPeriod', { defaultValue: 'Traffic Reset Period' })}
              </label>
              <select
                value={trafficResetPeriod}
                onChange={(event) => setTrafficResetPeriod(event.target.value as 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | '')}
                className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
              >
                <option value="">{t('groups.editor.noOverride', { defaultValue: 'No override' })}</option>
                <option value="NEVER">{t('groups.resetPeriod.never', { defaultValue: 'NEVER' })}</option>
                <option value="DAILY">{t('groups.resetPeriod.daily', { defaultValue: 'DAILY' })}</option>
                <option value="WEEKLY">{t('groups.resetPeriod.weekly', { defaultValue: 'WEEKLY' })}</option>
                <option value="MONTHLY">{t('groups.resetPeriod.monthly', { defaultValue: 'MONTHLY' })}</option>
              </select>
            </div>

            <Input
              label={t('groups.editor.trafficResetDay', { defaultValue: 'Traffic Reset Day' })}
              type="number"
              min={1}
              max={31}
              value={trafficResetDay}
              onChange={(event) => setTrafficResetDay(event.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line/70 px-6 py-4">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            {template
              ? t('groups.editor.saveChanges', { defaultValue: 'Save Changes' })
              : t('groups.templates.editor.createCta', { defaultValue: 'Create Template' })}
          </Button>
        </div>
      </div>
    </div>
  );
}

type ScheduleEditorModalProps = {
  schedule: GroupPolicySchedule | null;
  groups: Group[];
  templates: GroupPolicyTemplate[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: ScheduleEditorValues) => Promise<void>;
};

function ScheduleEditorModal({ schedule, groups, templates, saving, onClose, onSubmit }: ScheduleEditorModalProps) {
  const toast = useToast();
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [cronExpression, setCronExpression] = useState('0 3 * * *');
  const [timezone, setTimezone] = useState('UTC');
  const [enabled, setEnabled] = useState(true);
  const [dryRun, setDryRun] = useState(false);
  const [targetUserIdsText, setTargetUserIdsText] = useState('');

  useEffect(() => {
    setName(schedule?.name || '');
    setGroupId(schedule?.groupId ? String(schedule.groupId) : '');
    setTemplateId(schedule?.templateId ? String(schedule.templateId) : '');
    setCronExpression(schedule?.cronExpression || '0 3 * * *');
    setTimezone(schedule?.timezone || 'UTC');
    setEnabled(schedule?.enabled ?? true);
    setDryRun(schedule?.dryRun ?? false);
    setTargetUserIdsText((schedule?.targetUserIds || []).join(','));
  }, [schedule]);

  const handleSave = async () => {
    const parsedGroupId = Number.parseInt(groupId, 10);
    if (!Number.isInteger(parsedGroupId) || parsedGroupId < 1) {
      toast.error(
        t('common.validationFailed', { defaultValue: 'Validation failed' }),
        t('groups.schedules.editor.groupRequired', { defaultValue: 'Please select a valid group.' })
      );
      return;
    }

    const safeName = name.trim();
    if (!safeName) {
      toast.error(
        t('common.validationFailed', { defaultValue: 'Validation failed' }),
        t('groups.schedules.editor.nameRequired', { defaultValue: 'Schedule name is required.' })
      );
      return;
    }

    const safeCron = cronExpression.trim();
    if (!safeCron) {
      toast.error(
        t('common.validationFailed', { defaultValue: 'Validation failed' }),
        t('groups.schedules.editor.cronRequired', { defaultValue: 'Cron expression is required.' })
      );
      return;
    }

    await onSubmit({
      name: safeName,
      groupId: parsedGroupId,
      templateId: templateId ? Number.parseInt(templateId, 10) : null,
      cronExpression: safeCron,
      timezone: timezone.trim() || 'UTC',
      enabled,
      dryRun,
      targetUserIds: parseUserIdsCsv(targetUserIdsText)
    });
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-2xl rounded-2xl">
        <div className="border-b border-line/70 px-6 py-4">
          <h2 className="text-xl font-semibold text-foreground">
            {schedule
              ? t('groups.schedules.editor.editTitle', { defaultValue: 'Edit Policy Schedule' })
              : t('groups.schedules.editor.createTitle', { defaultValue: 'Create Policy Schedule' })}
          </h2>
          <p className="text-sm text-muted">
            {t('groups.schedules.editor.subtitle', { defaultValue: 'Automate recurring group policy rollouts.' })}
          </p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <Input
            label={t('groups.schedules.editor.nameLabel', { defaultValue: 'Schedule Name *' })}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('groups.schedules.editor.namePlaceholder', { defaultValue: 'Nightly premium sync' })}
          />

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="ml-1 block text-sm font-medium text-muted">
                {t('groups.schedules.editor.groupLabel', { defaultValue: 'Group *' })}
              </label>
              <select
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
              >
                <option value="">{t('groups.schedules.editor.groupPlaceholder', { defaultValue: 'Select group' })}</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="ml-1 block text-sm font-medium text-muted">
                {t('groups.schedules.editor.templateLabel', { defaultValue: 'Template (optional)' })}
              </label>
              <select
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
                className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
              >
                <option value="">{t('groups.schedules.editor.noTemplate', { defaultValue: 'No template' })}</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </div>

            <Input
              label={t('groups.schedules.editor.cronLabel', { defaultValue: 'Cron Expression *' })}
              value={cronExpression}
              onChange={(event) => setCronExpression(event.target.value)}
              placeholder="0 3 * * *"
            />

            <Input
              label={t('groups.schedules.editor.timezoneLabel', { defaultValue: 'Timezone' })}
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="UTC"
            />
          </div>

          <Input
            label={t('groups.schedules.editor.targetUserIdsLabel', { defaultValue: 'Target User IDs (optional, comma-separated)' })}
            value={targetUserIdsText}
            onChange={(event) => setTargetUserIdsText(event.target.value)}
            placeholder={t('groups.schedules.editor.targetUserIdsPlaceholder', { defaultValue: '1,2,3' })}
          />

          <div className="rounded-xl border border-line/70 bg-panel/55 p-3 text-xs text-muted">
            {t('groups.schedules.editor.cronExamples', {
              defaultValue: 'Cron examples: `0 3 * * *` (daily 03:00), `*/30 * * * *` (every 30 minutes), `0 9 * * 1` (weekly Monday).'
            })}
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="h-4 w-4 rounded border-line bg-card text-brand-500"
              />
              {t('common.enabled', { defaultValue: 'Enabled' })}
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(event) => setDryRun(event.target.checked)}
                className="h-4 w-4 rounded border-line bg-card text-brand-500"
              />
              {t('groups.schedules.editor.dryRunOnly', { defaultValue: 'Dry-run only' })}
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line/70 px-6 py-4">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            {schedule
              ? t('groups.editor.saveChanges', { defaultValue: 'Save Changes' })
              : t('groups.schedules.editor.createCta', { defaultValue: 'Create Schedule' })}
          </Button>
        </div>
      </div>
    </div>
  );
}

type ApplyTemplateModalProps = {
  template: GroupPolicyTemplate;
  groups: Group[];
  applying: boolean;
  onClose: () => void;
  onSubmit: (payload: { groupId: number; applyNow: boolean; dryRun: boolean; userIds: number[] }) => Promise<void>;
};

function ApplyTemplateModal({ template, groups, applying, onClose, onSubmit }: ApplyTemplateModalProps) {
  const toast = useToast();
  const { t } = useTranslation();
  const [groupId, setGroupId] = useState('');
  const [applyNow, setApplyNow] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [userIdsText, setUserIdsText] = useState('');

  const handleApply = async () => {
    const parsedGroupId = Number.parseInt(groupId, 10);
    if (!Number.isInteger(parsedGroupId) || parsedGroupId < 1) {
      toast.error(
        t('common.validationFailed', { defaultValue: 'Validation failed' }),
        t('groups.templates.applyModal.groupRequired', { defaultValue: 'Please select a group.' })
      );
      return;
    }

    await onSubmit({
      groupId: parsedGroupId,
      applyNow,
      dryRun,
      userIds: parseUserIdsCsv(userIdsText)
    });
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-lg rounded-2xl">
        <div className="border-b border-line/70 px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t('groups.templates.applyModal.title', { defaultValue: 'Apply Template: {{name}}', name: template.name })}
          </h2>
          <p className="text-sm text-muted">
            {t('groups.templates.applyModal.subtitle', { defaultValue: 'Copy template policy into a target group.' })}
          </p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="space-y-1.5">
            <label className="ml-1 block text-sm font-medium text-muted">
              {t('groups.templates.applyModal.groupLabel', { defaultValue: 'Target Group *' })}
            </label>
            <select
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <option value="">{t('groups.templates.applyModal.groupPlaceholder', { defaultValue: 'Select group' })}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={applyNow}
              onChange={(event) => setApplyNow(event.target.checked)}
              className="h-4 w-4 rounded border-line bg-card text-brand-500"
            />
            {t('groups.templates.applyModal.applyNow', { defaultValue: 'Run policy rollout immediately after template apply' })}
          </label>

          {applyNow ? (
            <>
              <label className="inline-flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(event) => setDryRun(event.target.checked)}
                  className="h-4 w-4 rounded border-line bg-card text-brand-500"
                />
                {t('groups.templates.applyModal.dryRun', { defaultValue: 'Dry-run immediate rollout' })}
              </label>
              <Input
                label={t('groups.templates.applyModal.targetUserIdsLabel', { defaultValue: 'Target User IDs (optional)' })}
                value={userIdsText}
                onChange={(event) => setUserIdsText(event.target.value)}
                placeholder={t('groups.templates.applyModal.targetUserIdsPlaceholder', { defaultValue: '1,2,3' })}
              />
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line/70 px-6 py-4">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button onClick={() => void handleApply()} loading={applying}>
            {t('groups.templates.applyModal.applyCta', { defaultValue: 'Apply Template' })}
          </Button>
        </div>
      </div>
    </div>
  );
}

function getRolloutSummary(rollout: GroupPolicyRollout) {
  const payload = rollout.summary as
    | {
        summary?: { targetUsers?: number; wouldUpdateUsers?: number; skippedUsers?: number };
        result?: { summary?: { targetUsers?: number; wouldUpdateUsers?: number; skippedUsers?: number } };
      }
    | undefined;

  return payload?.summary || payload?.result?.summary || null;
}

export function Groups() {
  const { t } = useTranslation();
  const toast = useToast();
  const { id: routeGroupId } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<GroupTab>('groups');
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteTarget>(null);

  const [groupPage, setGroupPage] = useState(1);
  const [groupSearch, setGroupSearch] = useState('');
  const [includeDisabled, setIncludeDisabled] = useState(true);
  const debouncedGroupSearch = useDebouncedValue(groupSearch, 320);

  const [templatePage, setTemplatePage] = useState(1);
  const [templateSearch, setTemplateSearch] = useState('');
  const debouncedTemplateSearch = useDebouncedValue(templateSearch, 320);

  const [schedulePage, setSchedulePage] = useState(1);
  const [scheduleSearch, setScheduleSearch] = useState('');
  const [scheduleGroupFilter, setScheduleGroupFilter] = useState('');
  const [scheduleEnabledFilter, setScheduleEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const debouncedScheduleSearch = useDebouncedValue(scheduleSearch, 320);

  const [rolloutPage, setRolloutPage] = useState(1);
  const [rolloutGroupFilter, setRolloutGroupFilter] = useState('');
  const [rolloutStatusFilter, setRolloutStatusFilter] = useState<'ALL' | 'SUCCESS' | 'FAILED' | 'DRY_RUN'>('ALL');
  const [rolloutSourceFilter, setRolloutSourceFilter] = useState<'ALL' | 'MANUAL' | 'SCHEDULED'>('ALL');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);

  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<GroupPolicyTemplate | null>(null);
  const [applyTemplateTarget, setApplyTemplateTarget] = useState<GroupPolicyTemplate | null>(null);

  const [scheduleEditorOpen, setScheduleEditorOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<GroupPolicySchedule | null>(null);

  const groupsQuery = useGroups({
    page: groupPage,
    limit: 20,
    search: debouncedGroupSearch,
    includeDisabled
  });
  const usersQuery = useUsers({ page: 1, limit: 100 });
  const inboundsQuery = useInbounds();

  const templatesQuery = useGroupPolicyTemplates({
    page: templatePage,
    limit: 20,
    search: debouncedTemplateSearch
  });

  const schedulesQuery = useGroupPolicySchedules({
    page: schedulePage,
    limit: 20,
    search: debouncedScheduleSearch,
    groupId: scheduleGroupFilter ? Number.parseInt(scheduleGroupFilter, 10) : undefined,
    enabled:
      scheduleEnabledFilter === 'all'
        ? undefined
        : scheduleEnabledFilter === 'enabled'
  });

  const rolloutsQuery = useGroupPolicyRollouts({
    page: rolloutPage,
    limit: 25,
    groupId: rolloutGroupFilter ? Number.parseInt(rolloutGroupFilter, 10) : undefined,
    status: rolloutStatusFilter === 'ALL' ? undefined : rolloutStatusFilter,
    source: rolloutSourceFilter === 'ALL' ? undefined : rolloutSourceFilter
  });

  const createGroupMutation = useCreateGroup();
  const updateGroupMutation = useUpdateGroup();
  const deleteGroupMutation = useDeleteGroup();

  const createTemplateMutation = useCreateGroupPolicyTemplate();
  const updateTemplateMutation = useUpdateGroupPolicyTemplate();
  const deleteTemplateMutation = useDeleteGroupPolicyTemplate();
  const applyTemplateMutation = useApplyGroupPolicyTemplate();

  const createScheduleMutation = useCreateGroupPolicySchedule();
  const updateScheduleMutation = useUpdateGroupPolicySchedule();
  const deleteScheduleMutation = useDeleteGroupPolicySchedule();
  const runScheduleMutation = useRunGroupPolicySchedule();

  const groups = useMemo<Group[]>(() => groupsQuery.data?.data ?? [], [groupsQuery.data?.data]);
  const groupPagination = extractPagination(groupsQuery.data);

  const templates = useMemo<GroupPolicyTemplate[]>(() => templatesQuery.data?.data ?? [], [templatesQuery.data?.data]);
  const templatePagination = extractPagination(templatesQuery.data);

  const schedules = useMemo<GroupPolicySchedule[]>(() => schedulesQuery.data?.data ?? [], [schedulesQuery.data?.data]);
  const schedulePagination = extractPagination(schedulesQuery.data);

  const rollouts = useMemo<GroupPolicyRollout[]>(() => rolloutsQuery.data?.data ?? [], [rolloutsQuery.data?.data]);
  const rolloutPagination = extractPagination(rolloutsQuery.data);

  const users = useMemo<UserOption[]>(
    () =>
      (usersQuery.data?.data || []).map((user) => ({
        id: user.id,
        email: user.email,
        status: user.status
      })),
    [usersQuery.data?.data]
  );

  const inbounds = useMemo<InboundOption[]>(
    () =>
      ((inboundsQuery.data || []) as Inbound[])
        .map((inbound) => ({
          id: inbound.id,
          tag: inbound.tag,
          protocol: inbound.protocol,
          port: inbound.port,
          enabled: inbound.enabled,
          remark: inbound.remark
        }))
        .sort((first, second) => first.port - second.port),
    [inboundsQuery.data]
  );

  const enabledGroups = useMemo(() => groups.filter((group) => !group.isDisabled).length, [groups]);
  const totalUsersInGroups = useMemo(() => groups.reduce((sum, group) => sum + Number(group._count?.users || 0), 0), [groups]);
  const totalInboundLinks = useMemo(() => groups.reduce((sum, group) => sum + Number(group._count?.inbounds || 0), 0), [groups]);

  useEffect(() => {
    setGroupPage(1);
  }, [debouncedGroupSearch, includeDisabled]);

  useEffect(() => {
    setTemplatePage(1);
  }, [debouncedTemplateSearch]);

  useEffect(() => {
    setSchedulePage(1);
  }, [debouncedScheduleSearch, scheduleGroupFilter, scheduleEnabledFilter]);

  useEffect(() => {
    setRolloutPage(1);
  }, [rolloutGroupFilter, rolloutStatusFilter, rolloutSourceFilter]);

  // Auto-open the group editor when navigated via /groups/:id
  useEffect(() => {
    if (routeGroupId && groups.length > 0) {
      const targetGroup = groups.find((g) => g.id === Number(routeGroupId));
      if (targetGroup && !editorOpen) {
        setEditingGroup(targetGroup);
        setEditorOpen(true);
      }
    }
  }, [routeGroupId, groups]);

  const handleRefresh = async () => {
    try {
      await Promise.all([
        groupsQuery.refetch(),
        usersQuery.refetch(),
        inboundsQuery.refetch(),
        templatesQuery.refetch(),
        schedulesQuery.refetch(),
        rolloutsQuery.refetch()
      ]);
      toast.success(
        t('groups.toast.refreshedTitle', { defaultValue: 'Data refreshed' }),
        t('groups.toast.refreshedBody', { defaultValue: 'Groups, templates, schedules, and rollouts are up to date.' })
      );
    } catch (error: any) {
      toast.error(
        t('groups.toast.refreshFailedTitle', { defaultValue: 'Refresh failed' }),
        error?.message || t('groups.toast.refreshFailedBody', { defaultValue: 'Failed to refresh group data.' })
      );
    }
  };

  const handleSaveGroup = async (values: GroupEditorValues) => {
    try {
      if (editingGroup) {
        await updateGroupMutation.mutateAsync({
          id: editingGroup.id,
          payload: values
        });
        toast.success(
          t('groups.toast.groupUpdatedTitle', { defaultValue: 'Group updated' }),
          t('groups.toast.groupUpdatedBody', { defaultValue: '"{{name}}" was updated successfully.', name: editingGroup.name })
        );
      } else {
        await createGroupMutation.mutateAsync(values);
        toast.success(
          t('groups.toast.groupCreatedTitle', { defaultValue: 'Group created' }),
          t('groups.toast.groupCreatedBody', { defaultValue: '"{{name}}" was created successfully.', name: values.name })
        );
      }

      await groupsQuery.refetch();
      setEditorOpen(false);
      setEditingGroup(null);
    } catch (error: any) {
      toast.error(
        t('groups.toast.saveGroupFailedTitle', { defaultValue: 'Failed to save group' }),
        error?.message || t('groups.toast.saveGroupFailedBody', { defaultValue: 'Could not save group changes.' })
      );
    }
  };

  const handleDeleteGroup = async (group: Group) => {
    setPendingDelete({ type: 'group', id: group.id, name: group.name });
  };

  const handleSaveTemplate = async (values: TemplateEditorValues) => {
    const payload = {
      ...values,
      description: values.description || null
    };

    try {
      if (editingTemplate) {
        await updateTemplateMutation.mutateAsync({
          templateId: editingTemplate.id,
          payload
        });
        toast.success(
          t('groups.toast.templateUpdatedTitle', { defaultValue: 'Template updated' }),
          t('groups.toast.templateUpdatedBody', { defaultValue: '"{{name}}" was updated.', name: editingTemplate.name })
        );
      } else {
        await createTemplateMutation.mutateAsync(payload);
        toast.success(
          t('groups.toast.templateCreatedTitle', { defaultValue: 'Template created' }),
          t('groups.toast.templateCreatedBody', { defaultValue: '"{{name}}" is ready to use.', name: values.name })
        );
      }

      await templatesQuery.refetch();
      setTemplateEditorOpen(false);
      setEditingTemplate(null);
    } catch (error: any) {
      toast.error(
        t('groups.toast.saveTemplateFailedTitle', { defaultValue: 'Failed to save template' }),
        error?.message || t('groups.toast.saveTemplateFailedBody', { defaultValue: 'Could not save template.' })
      );
    }
  };

  const handleDeleteTemplate = async (template: GroupPolicyTemplate) => {
    setPendingDelete({ type: 'template', id: template.id, name: template.name });
  };

  const handleApplyTemplate = async (payload: { groupId: number; applyNow: boolean; dryRun: boolean; userIds: number[] }) => {
    if (!applyTemplateTarget) {
      return;
    }

    try {
      const requestPayload: { templateId: number; applyNow?: boolean; dryRun?: boolean; userIds?: number[] } = {
        templateId: applyTemplateTarget.id
      };

      if (payload.applyNow) {
        requestPayload.applyNow = true;
        requestPayload.dryRun = payload.dryRun;
      }

      if (payload.userIds.length > 0) {
        requestPayload.userIds = payload.userIds;
      }

      await applyTemplateMutation.mutateAsync({
        groupId: payload.groupId,
        payload: requestPayload
      });

      await Promise.all([
        groupsQuery.refetch(),
        templatesQuery.refetch(),
        schedulesQuery.refetch(),
        rolloutsQuery.refetch()
      ]);
      setApplyTemplateTarget(null);
      toast.success(
        t('groups.toast.templateAppliedTitle', { defaultValue: 'Template applied' }),
        payload.applyNow
          ? t('groups.toast.templateAppliedBodyNow', { defaultValue: 'Group policy was updated and rollout was triggered.' })
          : t('groups.toast.templateAppliedBodyValues', { defaultValue: 'Group policy values were updated successfully.' })
      );
    } catch (error: any) {
      toast.error(
        t('groups.toast.applyTemplateFailedTitle', { defaultValue: 'Apply template failed' }),
        error?.message || t('groups.toast.applyTemplateFailedBody', { defaultValue: 'Failed to apply template to group.' })
      );
    }
  };

  const handleSaveSchedule = async (values: ScheduleEditorValues) => {
    const payload = {
      ...values,
      templateId: values.templateId || null
    };

    try {
      if (editingSchedule) {
        await updateScheduleMutation.mutateAsync({
          scheduleId: editingSchedule.id,
          payload
        });
        toast.success(
          t('groups.toast.scheduleUpdatedTitle', { defaultValue: 'Schedule updated' }),
          t('groups.toast.scheduleUpdatedBody', { defaultValue: '"{{name}}" was updated.', name: editingSchedule.name })
        );
      } else {
        await createScheduleMutation.mutateAsync(payload);
        toast.success(
          t('groups.toast.scheduleCreatedTitle', { defaultValue: 'Schedule created' }),
          t('groups.toast.scheduleCreatedBody', { defaultValue: '"{{name}}" has been scheduled.', name: values.name })
        );
      }

      await schedulesQuery.refetch();
      setScheduleEditorOpen(false);
      setEditingSchedule(null);
    } catch (error: any) {
      toast.error(
        t('groups.toast.saveScheduleFailedTitle', { defaultValue: 'Failed to save schedule' }),
        error?.message || t('groups.toast.saveScheduleFailedBody', { defaultValue: 'Could not save schedule.' })
      );
    }
  };

  const handleDeleteSchedule = async (schedule: GroupPolicySchedule) => {
    setPendingDelete({ type: 'schedule', id: schedule.id, name: schedule.name });
  };

  const deleteLoading = pendingDelete?.type === 'group'
    ? deleteGroupMutation.isPending
    : pendingDelete?.type === 'template'
    ? deleteTemplateMutation.isPending
    : pendingDelete?.type === 'schedule'
    ? deleteScheduleMutation.isPending
    : false;

  const handleConfirmDelete = async () => {
    if (!pendingDelete) {
      return;
    }

    try {
      if (pendingDelete.type === 'group') {
        await deleteGroupMutation.mutateAsync(pendingDelete.id);
        await groupsQuery.refetch();
        toast.success(
          t('groups.toast.groupDeletedTitle', { defaultValue: 'Group deleted' }),
          t('groups.toast.deletedBody', { defaultValue: '"{{name}}" was deleted.', name: pendingDelete.name })
        );
      } else if (pendingDelete.type === 'template') {
        await deleteTemplateMutation.mutateAsync(pendingDelete.id);
        await templatesQuery.refetch();
        toast.success(
          t('groups.toast.templateDeletedTitle', { defaultValue: 'Template deleted' }),
          t('groups.toast.deletedBody', { defaultValue: '"{{name}}" was deleted.', name: pendingDelete.name })
        );
      } else {
        await deleteScheduleMutation.mutateAsync(pendingDelete.id);
        await Promise.all([schedulesQuery.refetch(), rolloutsQuery.refetch()]);
        toast.success(
          t('groups.toast.scheduleDeletedTitle', { defaultValue: 'Schedule deleted' }),
          t('groups.toast.deletedBody', { defaultValue: '"{{name}}" was deleted.', name: pendingDelete.name })
        );
      }
      setPendingDelete(null);
    } catch (error: any) {
      toast.error(
        t('groups.toast.deleteFailedTitle', { defaultValue: 'Delete failed' }),
        error?.message ||
          t('groups.toast.deleteFailedBody', { defaultValue: 'Failed to delete "{{name}}".', name: pendingDelete.name })
      );
    }
  };

  const handleRunSchedule = async (schedule: GroupPolicySchedule) => {
    try {
      await runScheduleMutation.mutateAsync(schedule.id);
      await Promise.all([schedulesQuery.refetch(), rolloutsQuery.refetch(), groupsQuery.refetch()]);
      toast.success(
        t('groups.toast.scheduleExecutedTitle', { defaultValue: 'Schedule executed' }),
        t('groups.toast.scheduleExecutedBody', {
          defaultValue: '"{{name}}" executed successfully.',
          name: schedule.name
        })
      );
    } catch (error: any) {
      toast.error(
        t('groups.toast.runFailedTitle', { defaultValue: 'Run failed' }),
        error?.message ||
          t('groups.toast.runFailedBody', {
            defaultValue: 'Failed to run schedule "{{name}}".',
            name: schedule.name
          })
      );
    }
  };

  const isSavingGroup = createGroupMutation.isPending || updateGroupMutation.isPending;
  const isSavingTemplate = createTemplateMutation.isPending || updateTemplateMutation.isPending;
  const isSavingSchedule = createScheduleMutation.isPending || updateScheduleMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            {t('groups.title', { defaultValue: 'Groups' })}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {t('groups.subtitle', {
              defaultValue: 'Reusable policy templates, schedules, and rollout history.'
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void handleRefresh()} loading={groupsQuery.isFetching || templatesQuery.isFetching || schedulesQuery.isFetching || rolloutsQuery.isFetching}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('common.refresh', { defaultValue: 'Refresh' })}
          </Button>
          {activeTab === 'groups' ? (
            <Button onClick={() => { setEditingGroup(null); setEditorOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              {t('groups.newGroup', { defaultValue: 'New Group' })}
            </Button>
          ) : null}
          {activeTab === 'templates' ? (
            <Button onClick={() => { setEditingTemplate(null); setTemplateEditorOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              {t('groups.newTemplate', { defaultValue: 'New Template' })}
            </Button>
          ) : null}
          {activeTab === 'schedules' ? (
            <Button onClick={() => { setEditingSchedule(null); setScheduleEditorOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              {t('groups.newSchedule', { defaultValue: 'New Schedule' })}
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="p-3 sm:p-4">
        <div className="overflow-x-auto">
          <div className="inline-flex min-w-full gap-1 rounded-xl border border-line/70 bg-panel/45 p-1">
            {([
              { id: 'groups', label: t('groups.tabs.groups', { defaultValue: 'Groups' }), count: groupPagination?.total || groups.length, icon: Layers3 },
              { id: 'templates', label: t('groups.tabs.templates', { defaultValue: 'Templates' }), count: templatePagination?.total || templates.length, icon: Sparkles },
              { id: 'schedules', label: t('groups.tabs.schedules', { defaultValue: 'Schedules' }), count: schedulePagination?.total || schedules.length, icon: Clock3 },
              { id: 'rollouts', label: t('groups.tabs.rollouts', { defaultValue: 'Rollouts' }), count: rolloutPagination?.total || rollouts.length, icon: RefreshCw }
            ] as Array<{ id: GroupTab; label: string; count: number; icon: typeof Layers3 }>).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex min-w-[140px] flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-soft' : 'text-muted hover:bg-card/70 hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${active ? 'bg-white/20 text-white' : 'bg-card/80 text-foreground/80'}`}>{tab.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {activeTab === 'groups' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="p-4">
              <p className="text-sm text-muted">
                {t('groups.stats.groups', { defaultValue: 'Groups' })}
              </p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{groupPagination?.total || groups.length}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted">
                {t('groups.stats.enabled', { defaultValue: 'Enabled' })}
              </p>
              <p className="mt-1 text-2xl font-semibold text-emerald-400">{enabledGroups}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted">
                {t('groups.stats.memberships', { defaultValue: 'User memberships' })}
              </p>
              <p className="mt-1 text-2xl font-semibold text-sky-400">{totalUsersInGroups}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted">
                {t('groups.stats.inboundMappings', { defaultValue: 'Inbound mappings' })}
              </p>
              <p className="mt-1 text-2xl font-semibold text-violet-400">{totalInboundLinks}</p>
            </Card>
          </div>

          <Card className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input
                  value={groupSearch}
                  onChange={(event) => setGroupSearch(event.target.value)}
                  placeholder={t('groups.searchPlaceholder', { defaultValue: 'Search groups by name or remark' })}
                  className="pl-9"
                />
              </div>
              <label className="inline-flex items-center gap-2 rounded-xl border border-line/70 bg-card/70 px-3 py-2.5 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={includeDisabled}
                  onChange={(event) => setIncludeDisabled(event.target.checked)}
                  className="h-4 w-4 rounded border-line bg-card text-brand-500"
                />
                {t('groups.showDisabled', { defaultValue: 'Show disabled groups' })}
              </label>
            </div>
          </Card>

          {groupsQuery.isLoading ? (
            <Card className="p-10 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-line/70 border-t-brand-500" />
              <p className="mt-4 text-sm text-muted">
                {t('groups.loading', { defaultValue: 'Loading groups...' })}
              </p>
            </Card>
          ) : groups.length === 0 ? (
            <Card className="p-10 text-center">
              <Layers3 className="mx-auto h-10 w-10 text-muted" />
              <h3 className="mt-3 text-lg font-semibold text-foreground">
                {t('groups.emptyTitle', { defaultValue: 'No groups found' })}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {t('groups.emptyBody', { defaultValue: 'Create your first group to reuse user/inbound assignments.' })}
              </p>
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {groups.map((group) => {
                const chips = buildPolicyChips(group, t);
                return (
                  <Card key={group.id} className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-semibold text-foreground">{group.name}</h3>
                        <p className="mt-1 text-sm text-muted">
                          {group.remark || t('groups.noRemark', { defaultValue: 'No remark provided' })}
                        </p>
                      </div>
                      <Badge variant={group.isDisabled ? 'warning' : 'success'}>
                        {group.isDisabled
                          ? t('common.disabled', { defaultValue: 'Disabled' })
                          : t('common.active', { defaultValue: 'Active' })}
                      </Badge>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-line/60 bg-panel/55 p-3">
                        <p className="text-xs uppercase tracking-[0.1em] text-muted">
                          {t('groups.labels.users', { defaultValue: 'Users' })}
                        </p>
                        <p className="mt-1 inline-flex items-center gap-2 text-lg font-semibold text-foreground">
                          <UsersRound className="h-4 w-4 text-brand-400" />
                          {group._count?.users || 0}
                        </p>
                      </div>
                      <div className="rounded-xl border border-line/60 bg-panel/55 p-3">
                        <p className="text-xs uppercase tracking-[0.1em] text-muted">
                          {t('groups.labels.inbounds', { defaultValue: 'Inbounds' })}
                        </p>
                        <p className="mt-1 inline-flex items-center gap-2 text-lg font-semibold text-foreground">
                          <Wifi className="h-4 w-4 text-brand-400" />
                          {group._count?.inbounds || 0}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                        {t('groups.labels.policyOverrides', { defaultValue: 'Policy overrides' })}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {chips.length === 0 ? (
                          <span className="text-sm text-muted">
                            {t('groups.labels.noPolicyOverrides', { defaultValue: 'No policy overrides' })}
                          </span>
                        ) : chips.map((chip) => (
                          <span key={`${group.id}-${chip}`} className="rounded-full border border-line/70 bg-card/70 px-2.5 py-1 text-xs text-foreground">{chip}</span>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t border-line/60 pt-3">
                      <Button variant="secondary" size="sm" onClick={() => { setEditingGroup(group); setEditorOpen(true); }}>
                        {t('common.edit', { defaultValue: 'Edit' })}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => void handleDeleteGroup(group)} loading={deleteGroupMutation.isPending}>
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        {t('common.delete', { defaultValue: 'Delete' })}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {groupPagination && groupPagination.totalPages > 1 ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-muted">
                {t('common.page', {
                  defaultValue: 'Page {{current}} of {{total}}',
                  current: groupPagination.page,
                  total: groupPagination.totalPages
                })}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={groupPage <= 1} onClick={() => setGroupPage((prev) => Math.max(1, prev - 1))}>
                  {t('common.previous', { defaultValue: 'Previous' })}
                </Button>
                <Button variant="secondary" size="sm" disabled={groupPage >= groupPagination.totalPages} onClick={() => setGroupPage((prev) => Math.min(groupPagination.totalPages, prev + 1))}>
                  {t('common.next', { defaultValue: 'Next' })}
                </Button>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {activeTab === 'templates' ? (
        <>
          <Card>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={templateSearch}
                onChange={(event) => setTemplateSearch(event.target.value)}
                placeholder={t('groups.templates.searchPlaceholder', { defaultValue: 'Search templates by name or description' })}
                className="pl-9"
              />
            </div>
          </Card>

          {templatesQuery.isLoading ? (
            <Card className="p-10 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-line/70 border-t-brand-500" />
              <p className="mt-4 text-sm text-muted">
                {t('groups.templates.loading', { defaultValue: 'Loading templates...' })}
              </p>
            </Card>
          ) : templates.length === 0 ? (
            <Card className="p-10 text-center">
              <Sparkles className="mx-auto h-10 w-10 text-muted" />
              <h3 className="mt-3 text-lg font-semibold text-foreground">
                {t('groups.templates.emptyTitle', { defaultValue: 'No templates found' })}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {t('groups.templates.emptyBody', { defaultValue: 'Create your first reusable policy template.' })}
              </p>
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {templates.map((template) => {
                const chips = buildPolicyChips(template, t);
                return (
                  <Card key={template.id} className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-foreground">{template.name}</h3>
                        <p className="mt-1 text-sm text-muted">
                          {template.description || t('groups.templates.noDescription', { defaultValue: 'No description' })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {template.isDefault ? (
                          <Badge variant="info">
                            {t('groups.templates.defaultBadge', { defaultValue: 'Default' })}
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {chips.length === 0 ? (
                        <span className="text-sm text-muted">
                          {t('groups.templates.noPolicyFields', { defaultValue: 'No policy fields configured' })}
                        </span>
                      ) : chips.map((chip) => (
                        <span key={`${template.id}-${chip}`} className="rounded-full border border-line/70 bg-card/70 px-2.5 py-1 text-xs text-foreground">{chip}</span>
                      ))}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-line/60 bg-panel/55 p-3">
                        <p className="text-xs uppercase tracking-[0.1em] text-muted">
                          {t('groups.templates.metrics.schedules', { defaultValue: 'Schedules' })}
                        </p>
                        <p className="mt-1 text-lg font-semibold text-foreground">{template._count?.schedules || 0}</p>
                      </div>
                      <div className="rounded-xl border border-line/60 bg-panel/55 p-3">
                        <p className="text-xs uppercase tracking-[0.1em] text-muted">
                          {t('groups.templates.metrics.rollouts', { defaultValue: 'Rollouts' })}
                        </p>
                        <p className="mt-1 text-lg font-semibold text-foreground">{template._count?.rollouts || 0}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2 border-t border-line/60 pt-3">
                      <Button variant="secondary" size="sm" onClick={() => setApplyTemplateTarget(template)}>
                        {t('groups.templates.applyToGroup', { defaultValue: 'Apply to Group' })}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => { setEditingTemplate(template); setTemplateEditorOpen(true); }}>
                        {t('common.edit', { defaultValue: 'Edit' })}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => void handleDeleteTemplate(template)} loading={deleteTemplateMutation.isPending}>
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        {t('common.delete', { defaultValue: 'Delete' })}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {templatePagination && templatePagination.totalPages > 1 ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-muted">
                {t('common.page', {
                  defaultValue: 'Page {{current}} of {{total}}',
                  current: templatePagination.page,
                  total: templatePagination.totalPages
                })}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={templatePage <= 1} onClick={() => setTemplatePage((prev) => Math.max(1, prev - 1))}>
                  {t('common.previous', { defaultValue: 'Previous' })}
                </Button>
                <Button variant="secondary" size="sm" disabled={templatePage >= templatePagination.totalPages} onClick={() => setTemplatePage((prev) => Math.min(templatePagination.totalPages, prev + 1))}>
                  {t('common.next', { defaultValue: 'Next' })}
                </Button>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {activeTab === 'schedules' ? (
        <>
          <Card className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="relative lg:col-span-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input
                  value={scheduleSearch}
                  onChange={(event) => setScheduleSearch(event.target.value)}
                  placeholder={t('groups.schedules.searchPlaceholder', { defaultValue: 'Search schedules' })}
                  className="pl-9"
                />
              </div>

              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">
                  {t('groups.filters.group', { defaultValue: 'Group' })}
                </label>
                <select
                  value={scheduleGroupFilter}
                  onChange={(event) => setScheduleGroupFilter(event.target.value)}
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <option value="">{t('groups.filters.allGroups', { defaultValue: 'All groups' })}</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">
                  {t('common.status', { defaultValue: 'Status' })}
                </label>
                <select
                  value={scheduleEnabledFilter}
                  onChange={(event) => setScheduleEnabledFilter(event.target.value as 'all' | 'enabled' | 'disabled')}
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <option value="all">{t('common.all', { defaultValue: 'All' })}</option>
                  <option value="enabled">{t('common.enabled', { defaultValue: 'Enabled' })}</option>
                  <option value="disabled">{t('common.disabled', { defaultValue: 'Disabled' })}</option>
                </select>
              </div>
            </div>
          </Card>

          {schedulesQuery.isLoading ? (
            <Card className="p-10 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-line/70 border-t-brand-500" />
              <p className="mt-4 text-sm text-muted">
                {t('groups.schedules.loading', { defaultValue: 'Loading schedules...' })}
              </p>
            </Card>
          ) : schedules.length === 0 ? (
            <Card className="p-10 text-center">
              <Clock3 className="mx-auto h-10 w-10 text-muted" />
              <h3 className="mt-3 text-lg font-semibold text-foreground">
                {t('groups.schedules.emptyTitle', { defaultValue: 'No schedules found' })}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {t('groups.schedules.emptyBody', { defaultValue: 'Create a recurring rollout schedule for any group.' })}
              </p>
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="bg-panel/70">
                    <tr className="border-b border-line/70 text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-3">{t('groups.schedules.columns.name', { defaultValue: 'Name' })}</th>
                      <th className="px-4 py-3">{t('groups.schedules.columns.group', { defaultValue: 'Group' })}</th>
                      <th className="px-4 py-3">{t('groups.schedules.columns.template', { defaultValue: 'Template' })}</th>
                      <th className="px-4 py-3">{t('groups.schedules.columns.cron', { defaultValue: 'Cron' })}</th>
                      <th className="px-4 py-3">{t('groups.schedules.columns.lastRun', { defaultValue: 'Last Run' })}</th>
                      <th className="px-4 py-3">{t('groups.schedules.columns.runs', { defaultValue: 'Runs' })}</th>
                      <th className="px-4 py-3">{t('common.actions', { defaultValue: 'Actions' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((schedule) => (
                      <tr key={schedule.id} className="border-b border-line/70 hover:bg-panel/35">
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{schedule.name}</span>
                            <span className="text-xs text-muted">
                              {(schedule.enabled
                                ? t('common.enabled', { defaultValue: 'Enabled' })
                                : t('common.disabled', { defaultValue: 'Disabled' }))}{' '}
                              •{' '}
                              {(schedule.dryRun
                                ? t('groups.schedules.dryRun', { defaultValue: 'Dry-run' })
                                : t('groups.schedules.applyMode', { defaultValue: 'Apply mode' }))}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-foreground">{schedule.group?.name || `#${schedule.groupId}`}</td>
                        <td className="px-4 py-3 text-foreground">{schedule.template?.name || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs text-foreground">{schedule.cronExpression}</div>
                          <div className="text-xs text-muted">{schedule.timezone || 'UTC'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-foreground">
                            {schedule.lastRunAt
                              ? new Date(schedule.lastRunAt).toLocaleString()
                              : t('common.never', { defaultValue: 'Never' })}
                          </div>
                          <div className="text-xs text-muted">{schedule.lastStatus || '—'}</div>
                        </td>
                        <td className="px-4 py-3 text-foreground">{schedule.runCount}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Button variant="secondary" size="sm" onClick={() => void handleRunSchedule(schedule)} loading={runScheduleMutation.isPending}>
                              <Play className="mr-1.5 h-4 w-4" />
                              {t('common.run', { defaultValue: 'Run' })}
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => { setEditingSchedule(schedule); setScheduleEditorOpen(true); }}>
                              {t('common.edit', { defaultValue: 'Edit' })}
                            </Button>
                            <Button variant="danger" size="sm" onClick={() => void handleDeleteSchedule(schedule)} loading={deleteScheduleMutation.isPending}>
                              <Trash2 className="mr-1.5 h-4 w-4" />
                              {t('common.delete', { defaultValue: 'Delete' })}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {schedulePagination && schedulePagination.totalPages > 1 ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-muted">
                {t('common.page', {
                  defaultValue: 'Page {{current}} of {{total}}',
                  current: schedulePagination.page,
                  total: schedulePagination.totalPages
                })}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={schedulePage <= 1} onClick={() => setSchedulePage((prev) => Math.max(1, prev - 1))}>
                  {t('common.previous', { defaultValue: 'Previous' })}
                </Button>
                <Button variant="secondary" size="sm" disabled={schedulePage >= schedulePagination.totalPages} onClick={() => setSchedulePage((prev) => Math.min(schedulePagination.totalPages, prev + 1))}>
                  {t('common.next', { defaultValue: 'Next' })}
                </Button>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {activeTab === 'rollouts' ? (
        <>
          <Card className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">
                  {t('groups.filters.group', { defaultValue: 'Group' })}
                </label>
                <select
                  value={rolloutGroupFilter}
                  onChange={(event) => setRolloutGroupFilter(event.target.value)}
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <option value="">{t('groups.filters.allGroups', { defaultValue: 'All groups' })}</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">
                  {t('common.status', { defaultValue: 'Status' })}
                </label>
                <select
                  value={rolloutStatusFilter}
                  onChange={(event) => setRolloutStatusFilter(event.target.value as 'ALL' | 'SUCCESS' | 'FAILED' | 'DRY_RUN')}
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <option value="ALL">{t('common.all', { defaultValue: 'All' })}</option>
                  <option value="SUCCESS">{t('groups.rollouts.status.success', { defaultValue: 'SUCCESS' })}</option>
                  <option value="FAILED">{t('groups.rollouts.status.failed', { defaultValue: 'FAILED' })}</option>
                  <option value="DRY_RUN">{t('groups.rollouts.status.dryRun', { defaultValue: 'DRY_RUN' })}</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">
                  {t('groups.rollouts.filters.source', { defaultValue: 'Source' })}
                </label>
                <select
                  value={rolloutSourceFilter}
                  onChange={(event) => setRolloutSourceFilter(event.target.value as 'ALL' | 'MANUAL' | 'SCHEDULED')}
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <option value="ALL">{t('common.all', { defaultValue: 'All' })}</option>
                  <option value="MANUAL">{t('groups.rollouts.source.manual', { defaultValue: 'MANUAL' })}</option>
                  <option value="SCHEDULED">{t('groups.rollouts.source.scheduled', { defaultValue: 'SCHEDULED' })}</option>
                </select>
              </div>
            </div>
          </Card>

          {rolloutsQuery.isLoading ? (
            <Card className="p-10 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-line/70 border-t-brand-500" />
              <p className="mt-4 text-sm text-muted">
                {t('groups.rollouts.loading', { defaultValue: 'Loading rollout history...' })}
              </p>
            </Card>
          ) : rollouts.length === 0 ? (
            <Card className="p-10 text-center">
              <RefreshCw className="mx-auto h-10 w-10 text-muted" />
              <h3 className="mt-3 text-lg font-semibold text-foreground">
                {t('groups.rollouts.emptyTitle', { defaultValue: 'No rollout history' })}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {t('groups.rollouts.emptyBody', { defaultValue: 'Manual or scheduled policy applications will appear here.' })}
              </p>
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="bg-panel/70">
                    <tr className="border-b border-line/70 text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-3">{t('groups.rollouts.columns.time', { defaultValue: 'Time' })}</th>
                      <th className="px-4 py-3">{t('groups.rollouts.columns.group', { defaultValue: 'Group' })}</th>
                      <th className="px-4 py-3">{t('groups.rollouts.columns.template', { defaultValue: 'Template' })}</th>
                      <th className="px-4 py-3">{t('groups.rollouts.columns.source', { defaultValue: 'Source' })}</th>
                      <th className="px-4 py-3">{t('common.status', { defaultValue: 'Status' })}</th>
                      <th className="px-4 py-3">{t('groups.rollouts.columns.summary', { defaultValue: 'Summary' })}</th>
                      <th className="px-4 py-3">{t('groups.rollouts.columns.initiatedBy', { defaultValue: 'Initiated By' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rollouts.map((rollout) => {
                      const summary = getRolloutSummary(rollout);
                      return (
                        <tr key={rollout.id} className="border-b border-line/70 hover:bg-panel/35">
                          <td className="px-4 py-3 text-foreground">{new Date(rollout.createdAt).toLocaleString()}</td>
                          <td className="px-4 py-3 text-foreground">{rollout.group?.name || `#${rollout.groupId}`}</td>
                          <td className="px-4 py-3 text-foreground">{rollout.template?.name || '—'}</td>
                          <td className="px-4 py-3 text-foreground">{rollout.source}</td>
                          <td className="px-4 py-3">
                            <Badge variant={rollout.status === 'SUCCESS' ? 'success' : rollout.status === 'FAILED' ? 'danger' : 'warning'}>
                              {rollout.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            {summary ? (
                              <div className="text-xs text-muted">
                                {t('groups.rollouts.summaryLine', {
                                  defaultValue: 'Target: {{target}} • Updated: {{updated}} • Skipped: {{skipped}}',
                                  target: summary.targetUsers || 0,
                                  updated: summary.wouldUpdateUsers || 0,
                                  skipped: summary.skippedUsers || 0
                                })}
                              </div>
                            ) : (
                              <span className="text-xs text-muted">—</span>
                            )}
                            {rollout.errorMessage ? (
                              <div className="mt-1 text-xs text-red-400">{rollout.errorMessage}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-foreground">
                            {rollout.initiatedBy || t('common.system', { defaultValue: 'system' })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {rolloutPagination && rolloutPagination.totalPages > 1 ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-muted">
                {t('common.page', {
                  defaultValue: 'Page {{current}} of {{total}}',
                  current: rolloutPagination.page,
                  total: rolloutPagination.totalPages
                })}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={rolloutPage <= 1} onClick={() => setRolloutPage((prev) => Math.max(1, prev - 1))}>
                  {t('common.previous', { defaultValue: 'Previous' })}
                </Button>
                <Button variant="secondary" size="sm" disabled={rolloutPage >= rolloutPagination.totalPages} onClick={() => setRolloutPage((prev) => Math.min(rolloutPagination.totalPages, prev + 1))}>
                  {t('common.next', { defaultValue: 'Next' })}
                </Button>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {editorOpen ? (
        <GroupEditorModal
          group={editingGroup}
          users={users}
          inbounds={inbounds}
          saving={isSavingGroup}
          onClose={() => { setEditorOpen(false); setEditingGroup(null); }}
          onSubmit={handleSaveGroup}
        />
      ) : null}

      {templateEditorOpen ? (
        <TemplateEditorModal
          template={editingTemplate}
          saving={isSavingTemplate}
          onClose={() => { setTemplateEditorOpen(false); setEditingTemplate(null); }}
          onSubmit={handleSaveTemplate}
        />
      ) : null}

      {scheduleEditorOpen ? (
        <ScheduleEditorModal
          schedule={editingSchedule}
          groups={groups}
          templates={templates}
          saving={isSavingSchedule}
          onClose={() => { setScheduleEditorOpen(false); setEditingSchedule(null); }}
          onSubmit={handleSaveSchedule}
        />
      ) : null}

      {applyTemplateTarget ? (
        <ApplyTemplateModal
          template={applyTemplateTarget}
          groups={groups}
          applying={applyTemplateMutation.isPending}
          onClose={() => setApplyTemplateTarget(null)}
          onSubmit={handleApplyTemplate}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={
          pendingDelete?.type === 'group'
            ? t('groups.confirmDelete.title.group', { defaultValue: 'Delete Group' })
            : pendingDelete?.type === 'template'
            ? t('groups.confirmDelete.title.template', { defaultValue: 'Delete Template' })
            : pendingDelete?.type === 'schedule'
            ? t('groups.confirmDelete.title.schedule', { defaultValue: 'Delete Schedule' })
            : ''
        }
        description={
          pendingDelete
            ? t('groups.confirmDelete.body', {
              defaultValue: 'Delete "{{name}}"? This action cannot be undone.',
              name: pendingDelete.name
            })
            : ''
        }
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        cancelLabel={t('common.cancel', { defaultValue: 'Cancel' })}
        tone="danger"
        loading={deleteLoading}
        onCancel={() => {
          if (!deleteLoading) {
            setPendingDelete(null);
          }
        }}
        onConfirm={() => {
          void handleConfirmDelete();
        }}
      />
    </div>
  );
}
