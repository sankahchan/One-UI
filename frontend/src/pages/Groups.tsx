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

function buildPolicyChips(target: {
  dataLimit?: number | string | null;
  expiryDays?: number | null;
  ipLimit?: number | null;
  status?: User['status'] | null;
  trafficResetPeriod?: 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | null;
  trafficResetDay?: number | null;
}) {
  const chips: string[] = [];

  if (target.dataLimit !== null && target.dataLimit !== undefined) {
    chips.push(`Limit: ${target.dataLimit} GB`);
  }
  if (target.expiryDays !== null && target.expiryDays !== undefined) {
    chips.push(`Expiry: ${target.expiryDays}d`);
  }
  if (target.ipLimit !== null && target.ipLimit !== undefined) {
    chips.push(`IP: ${target.ipLimit}`);
  }
  if (target.status) {
    chips.push(`Status: ${target.status}`);
  }
  if (target.trafficResetPeriod) {
    chips.push(`Reset: ${target.trafficResetPeriod}${target.trafficResetDay ? `@${target.trafficResetDay}` : ''}`);
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
      toast.error('Validation failed', 'Group name is required.');
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
            <h2 className="text-xl font-semibold text-foreground">{group ? 'Edit Group' : 'Create Group'}</h2>
            <p className="text-sm text-muted">Reusable user, inbound and policy bundle.</p>
          </div>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>

        <div className="max-h-[calc(90vh-10rem)] space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Group Name *" value={name} onChange={(event) => setName(event.target.value)} placeholder="Premium users" />
            <Input label="Remark" value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="Optional note" />
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={isDisabled}
              onChange={(event) => setIsDisabled(event.target.checked)}
              className="h-4 w-4 rounded border-line bg-card text-brand-500"
            />
            Disable this group
          </label>

          <div className="rounded-xl border border-line/70 bg-panel/55 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted">Policy Overrides</h3>
            <p className="mt-1 text-xs text-muted">Leave empty to inherit each user policy.</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Input label="Data Limit (GB)" type="number" min={0} value={dataLimit} onChange={(event) => setDataLimit(event.target.value)} />
              <Input label="Expiry Days" type="number" min={1} value={expiryDays} onChange={(event) => setExpiryDays(event.target.value)} />
              <Input label="IP Limit (0 = unlimited)" type="number" min={0} value={ipLimit} onChange={(event) => setIpLimit(event.target.value)} />
              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">Status Override</label>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as User['status'] | '')}
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <option value="">No override</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="LIMITED">LIMITED</option>
                  <option value="EXPIRED">EXPIRED</option>
                  <option value="DISABLED">DISABLED</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">Traffic Reset Period</label>
                <select
                  value={trafficResetPeriod}
                  onChange={(event) => setTrafficResetPeriod(event.target.value as 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | '')}
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <option value="">No override</option>
                  <option value="NEVER">NEVER</option>
                  <option value="DAILY">DAILY</option>
                  <option value="WEEKLY">WEEKLY</option>
                  <option value="MONTHLY">MONTHLY</option>
                </select>
              </div>
              <Input
                label="Traffic Reset Day"
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
                <h3 className="text-sm font-semibold text-foreground">Users ({selectedUserIds.length})</h3>
                <Input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Filter users" className="max-w-[12rem] py-2 text-xs" />
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {filteredUsers.length === 0 ? (
                  <p className="text-sm text-muted">No users found.</p>
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
                <h3 className="text-sm font-semibold text-foreground">Inbounds ({selectedInboundIds.length})</h3>
                <Input value={inboundSearch} onChange={(event) => setInboundSearch(event.target.value)} placeholder="Filter inbounds" className="max-w-[12rem] py-2 text-xs" />
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {filteredInbounds.length === 0 ? (
                  <p className="text-sm text-muted">No inbounds found.</p>
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
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            {group ? 'Save Changes' : 'Create Group'}
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
      toast.error('Validation failed', 'Template name is required.');
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
          <h2 className="text-xl font-semibold text-foreground">{template ? 'Edit Policy Template' : 'Create Policy Template'}</h2>
          <p className="text-sm text-muted">Reusable policy overrides for multiple groups.</p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <Input label="Template Name *" value={name} onChange={(event) => setName(event.target.value)} placeholder="Monthly 50GB Standard" />
          <Input label="Description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional details" />

          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
              className="h-4 w-4 rounded border-line bg-card text-brand-500"
            />
            Mark as default template
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <Input label="Data Limit (GB)" type="number" min={0} value={dataLimit} onChange={(event) => setDataLimit(event.target.value)} />
            <Input label="Expiry Days" type="number" min={1} value={expiryDays} onChange={(event) => setExpiryDays(event.target.value)} />
            <Input label="IP Limit (0 = unlimited)" type="number" min={0} value={ipLimit} onChange={(event) => setIpLimit(event.target.value)} />

            <div className="space-y-1.5">
              <label className="ml-1 block text-sm font-medium text-muted">Status Override</label>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as User['status'] | '')}
                className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
              >
                <option value="">No override</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="LIMITED">LIMITED</option>
                <option value="EXPIRED">EXPIRED</option>
                <option value="DISABLED">DISABLED</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="ml-1 block text-sm font-medium text-muted">Traffic Reset Period</label>
              <select
                value={trafficResetPeriod}
                onChange={(event) => setTrafficResetPeriod(event.target.value as 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | '')}
                className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
              >
                <option value="">No override</option>
                <option value="NEVER">NEVER</option>
                <option value="DAILY">DAILY</option>
                <option value="WEEKLY">WEEKLY</option>
                <option value="MONTHLY">MONTHLY</option>
              </select>
            </div>

            <Input
              label="Traffic Reset Day"
              type="number"
              min={1}
              max={31}
              value={trafficResetDay}
              onChange={(event) => setTrafficResetDay(event.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line/70 px-6 py-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void handleSave()} loading={saving}>{template ? 'Save Changes' : 'Create Template'}</Button>
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
      toast.error('Validation failed', 'Please select a valid group.');
      return;
    }

    const safeName = name.trim();
    if (!safeName) {
      toast.error('Validation failed', 'Schedule name is required.');
      return;
    }

    const safeCron = cronExpression.trim();
    if (!safeCron) {
      toast.error('Validation failed', 'Cron expression is required.');
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
          <h2 className="text-xl font-semibold text-foreground">{schedule ? 'Edit Policy Schedule' : 'Create Policy Schedule'}</h2>
          <p className="text-sm text-muted">Automate recurring group policy rollouts.</p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <Input label="Schedule Name *" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nightly premium sync" />

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="ml-1 block text-sm font-medium text-muted">Group *</label>
              <select
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
              >
                <option value="">Select group</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="ml-1 block text-sm font-medium text-muted">Template (optional)</label>
              <select
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
                className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
              >
                <option value="">No template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </div>

            <Input
              label="Cron Expression *"
              value={cronExpression}
              onChange={(event) => setCronExpression(event.target.value)}
              placeholder="0 3 * * *"
            />

            <Input
              label="Timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="UTC"
            />
          </div>

          <Input
            label="Target User IDs (optional, comma-separated)"
            value={targetUserIdsText}
            onChange={(event) => setTargetUserIdsText(event.target.value)}
            placeholder="1,2,3"
          />

          <div className="rounded-xl border border-line/70 bg-panel/55 p-3 text-xs text-muted">
            Cron examples: `0 3 * * *` (daily 03:00), `*/30 * * * *` (every 30 minutes), `0 9 * * 1` (weekly Monday).
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="h-4 w-4 rounded border-line bg-card text-brand-500"
              />
              Enabled
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(event) => setDryRun(event.target.checked)}
                className="h-4 w-4 rounded border-line bg-card text-brand-500"
              />
              Dry-run only
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line/70 px-6 py-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void handleSave()} loading={saving}>{schedule ? 'Save Changes' : 'Create Schedule'}</Button>
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
  const [groupId, setGroupId] = useState('');
  const [applyNow, setApplyNow] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [userIdsText, setUserIdsText] = useState('');

  const handleApply = async () => {
    const parsedGroupId = Number.parseInt(groupId, 10);
    if (!Number.isInteger(parsedGroupId) || parsedGroupId < 1) {
      toast.error('Validation failed', 'Please select a group.');
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
          <h2 className="text-lg font-semibold text-foreground">Apply Template: {template.name}</h2>
          <p className="text-sm text-muted">Copy template policy into a target group.</p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="space-y-1.5">
            <label className="ml-1 block text-sm font-medium text-muted">Target Group *</label>
            <select
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <option value="">Select group</option>
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
            Run policy rollout immediately after template apply
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
                Dry-run immediate rollout
              </label>
              <Input
                label="Target User IDs (optional)"
                value={userIdsText}
                onChange={(event) => setUserIdsText(event.target.value)}
                placeholder="1,2,3"
              />
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line/70 px-6 py-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void handleApply()} loading={applying}>Apply Template</Button>
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
  const toast = useToast();
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
      toast.success('Data refreshed', 'Groups, templates, schedules, and rollouts are up to date.');
    } catch (error: any) {
      toast.error('Refresh failed', error?.message || 'Failed to refresh group data.');
    }
  };

  const handleSaveGroup = async (values: GroupEditorValues) => {
    try {
      if (editingGroup) {
        await updateGroupMutation.mutateAsync({
          id: editingGroup.id,
          payload: values
        });
        toast.success('Group updated', `"${editingGroup.name}" was updated successfully.`);
      } else {
        await createGroupMutation.mutateAsync(values);
        toast.success('Group created', `"${values.name}" was created successfully.`);
      }

      await groupsQuery.refetch();
      setEditorOpen(false);
      setEditingGroup(null);
    } catch (error: any) {
      toast.error('Failed to save group', error?.message || 'Could not save group changes.');
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
        toast.success('Template updated', `"${editingTemplate.name}" was updated.`);
      } else {
        await createTemplateMutation.mutateAsync(payload);
        toast.success('Template created', `"${values.name}" is ready to use.`);
      }

      await templatesQuery.refetch();
      setTemplateEditorOpen(false);
      setEditingTemplate(null);
    } catch (error: any) {
      toast.error('Failed to save template', error?.message || 'Could not save template.');
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
        'Template applied',
        payload.applyNow
          ? 'Group policy was updated and rollout was triggered.'
          : 'Group policy values were updated successfully.'
      );
    } catch (error: any) {
      toast.error('Apply template failed', error?.message || 'Failed to apply template to group.');
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
        toast.success('Schedule updated', `"${editingSchedule.name}" was updated.`);
      } else {
        await createScheduleMutation.mutateAsync(payload);
        toast.success('Schedule created', `"${values.name}" has been scheduled.`);
      }

      await schedulesQuery.refetch();
      setScheduleEditorOpen(false);
      setEditingSchedule(null);
    } catch (error: any) {
      toast.error('Failed to save schedule', error?.message || 'Could not save schedule.');
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
        toast.success('Group deleted', `"${pendingDelete.name}" was deleted.`);
      } else if (pendingDelete.type === 'template') {
        await deleteTemplateMutation.mutateAsync(pendingDelete.id);
        await templatesQuery.refetch();
        toast.success('Template deleted', `"${pendingDelete.name}" was deleted.`);
      } else {
        await deleteScheduleMutation.mutateAsync(pendingDelete.id);
        await Promise.all([schedulesQuery.refetch(), rolloutsQuery.refetch()]);
        toast.success('Schedule deleted', `"${pendingDelete.name}" was deleted.`);
      }
      setPendingDelete(null);
    } catch (error: any) {
      toast.error('Delete failed', error?.message || `Failed to delete "${pendingDelete.name}".`);
    }
  };

  const handleRunSchedule = async (schedule: GroupPolicySchedule) => {
    try {
      await runScheduleMutation.mutateAsync(schedule.id);
      await Promise.all([schedulesQuery.refetch(), rolloutsQuery.refetch(), groupsQuery.refetch()]);
      toast.success('Schedule executed', `"${schedule.name}" executed successfully.`);
    } catch (error: any) {
      toast.error('Run failed', error?.message || `Failed to run schedule "${schedule.name}".`);
    }
  };

  const isSavingGroup = createGroupMutation.isPending || updateGroupMutation.isPending;
  const isSavingTemplate = createTemplateMutation.isPending || updateTemplateMutation.isPending;
  const isSavingSchedule = createScheduleMutation.isPending || updateScheduleMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Groups</h1>
          <p className="mt-1 text-sm text-muted">Reusable policy templates, schedules, and rollout history.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void handleRefresh()} loading={groupsQuery.isFetching || templatesQuery.isFetching || schedulesQuery.isFetching || rolloutsQuery.isFetching}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          {activeTab === 'groups' ? (
            <Button onClick={() => { setEditingGroup(null); setEditorOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              New Group
            </Button>
          ) : null}
          {activeTab === 'templates' ? (
            <Button onClick={() => { setEditingTemplate(null); setTemplateEditorOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              New Template
            </Button>
          ) : null}
          {activeTab === 'schedules' ? (
            <Button onClick={() => { setEditingSchedule(null); setScheduleEditorOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              New Schedule
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="p-3 sm:p-4">
        <div className="overflow-x-auto">
          <div className="inline-flex min-w-full gap-1 rounded-xl border border-line/70 bg-panel/45 p-1">
            {([
              { id: 'groups', label: 'Groups', count: groupPagination?.total || groups.length, icon: Layers3 },
              { id: 'templates', label: 'Templates', count: templatePagination?.total || templates.length, icon: Sparkles },
              { id: 'schedules', label: 'Schedules', count: schedulePagination?.total || schedules.length, icon: Clock3 },
              { id: 'rollouts', label: 'Rollouts', count: rolloutPagination?.total || rollouts.length, icon: RefreshCw }
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
              <p className="text-sm text-muted">Groups</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{groupPagination?.total || groups.length}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted">Enabled</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-400">{enabledGroups}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted">User memberships</p>
              <p className="mt-1 text-2xl font-semibold text-sky-400">{totalUsersInGroups}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted">Inbound mappings</p>
              <p className="mt-1 text-2xl font-semibold text-violet-400">{totalInboundLinks}</p>
            </Card>
          </div>

          <Card className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder="Search groups by name or remark" className="pl-9" />
              </div>
              <label className="inline-flex items-center gap-2 rounded-xl border border-line/70 bg-card/70 px-3 py-2.5 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={includeDisabled}
                  onChange={(event) => setIncludeDisabled(event.target.checked)}
                  className="h-4 w-4 rounded border-line bg-card text-brand-500"
                />
                Show disabled groups
              </label>
            </div>
          </Card>

          {groupsQuery.isLoading ? (
            <Card className="p-10 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-line/70 border-t-brand-500" />
              <p className="mt-4 text-sm text-muted">Loading groups...</p>
            </Card>
          ) : groups.length === 0 ? (
            <Card className="p-10 text-center">
              <Layers3 className="mx-auto h-10 w-10 text-muted" />
              <h3 className="mt-3 text-lg font-semibold text-foreground">No groups found</h3>
              <p className="mt-1 text-sm text-muted">Create your first group to reuse user/inbound assignments.</p>
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {groups.map((group) => {
                const chips = buildPolicyChips(group);
                return (
                  <Card key={group.id} className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-semibold text-foreground">{group.name}</h3>
                        <p className="mt-1 text-sm text-muted">{group.remark || 'No remark provided'}</p>
                      </div>
                      <Badge variant={group.isDisabled ? 'warning' : 'success'}>
                        {group.isDisabled ? 'Disabled' : 'Active'}
                      </Badge>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-line/60 bg-panel/55 p-3">
                        <p className="text-xs uppercase tracking-[0.1em] text-muted">Users</p>
                        <p className="mt-1 inline-flex items-center gap-2 text-lg font-semibold text-foreground">
                          <UsersRound className="h-4 w-4 text-brand-400" />
                          {group._count?.users || 0}
                        </p>
                      </div>
                      <div className="rounded-xl border border-line/60 bg-panel/55 p-3">
                        <p className="text-xs uppercase tracking-[0.1em] text-muted">Inbounds</p>
                        <p className="mt-1 inline-flex items-center gap-2 text-lg font-semibold text-foreground">
                          <Wifi className="h-4 w-4 text-brand-400" />
                          {group._count?.inbounds || 0}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Policy overrides</p>
                      <div className="flex flex-wrap gap-1.5">
                        {chips.length === 0 ? (
                          <span className="text-sm text-muted">No policy overrides</span>
                        ) : chips.map((chip) => (
                          <span key={`${group.id}-${chip}`} className="rounded-full border border-line/70 bg-card/70 px-2.5 py-1 text-xs text-foreground">{chip}</span>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t border-line/60 pt-3">
                      <Button variant="secondary" size="sm" onClick={() => { setEditingGroup(group); setEditorOpen(true); }}>
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => void handleDeleteGroup(group)} loading={deleteGroupMutation.isPending}>
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {groupPagination && groupPagination.totalPages > 1 ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-muted">Page {groupPagination.page} of {groupPagination.totalPages}</p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={groupPage <= 1} onClick={() => setGroupPage((prev) => Math.max(1, prev - 1))}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={groupPage >= groupPagination.totalPages} onClick={() => setGroupPage((prev) => Math.min(groupPagination.totalPages, prev + 1))}>Next</Button>
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
              <Input value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} placeholder="Search templates by name or description" className="pl-9" />
            </div>
          </Card>

          {templatesQuery.isLoading ? (
            <Card className="p-10 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-line/70 border-t-brand-500" />
              <p className="mt-4 text-sm text-muted">Loading templates...</p>
            </Card>
          ) : templates.length === 0 ? (
            <Card className="p-10 text-center">
              <Sparkles className="mx-auto h-10 w-10 text-muted" />
              <h3 className="mt-3 text-lg font-semibold text-foreground">No templates found</h3>
              <p className="mt-1 text-sm text-muted">Create your first reusable policy template.</p>
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {templates.map((template) => {
                const chips = buildPolicyChips(template);
                return (
                  <Card key={template.id} className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-foreground">{template.name}</h3>
                        <p className="mt-1 text-sm text-muted">{template.description || 'No description'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {template.isDefault ? <Badge variant="info">Default</Badge> : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {chips.length === 0 ? (
                        <span className="text-sm text-muted">No policy fields configured</span>
                      ) : chips.map((chip) => (
                        <span key={`${template.id}-${chip}`} className="rounded-full border border-line/70 bg-card/70 px-2.5 py-1 text-xs text-foreground">{chip}</span>
                      ))}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-line/60 bg-panel/55 p-3">
                        <p className="text-xs uppercase tracking-[0.1em] text-muted">Schedules</p>
                        <p className="mt-1 text-lg font-semibold text-foreground">{template._count?.schedules || 0}</p>
                      </div>
                      <div className="rounded-xl border border-line/60 bg-panel/55 p-3">
                        <p className="text-xs uppercase tracking-[0.1em] text-muted">Rollouts</p>
                        <p className="mt-1 text-lg font-semibold text-foreground">{template._count?.rollouts || 0}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2 border-t border-line/60 pt-3">
                      <Button variant="secondary" size="sm" onClick={() => setApplyTemplateTarget(template)}>
                        Apply to Group
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => { setEditingTemplate(template); setTemplateEditorOpen(true); }}>
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => void handleDeleteTemplate(template)} loading={deleteTemplateMutation.isPending}>
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {templatePagination && templatePagination.totalPages > 1 ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-muted">Page {templatePagination.page} of {templatePagination.totalPages}</p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={templatePage <= 1} onClick={() => setTemplatePage((prev) => Math.max(1, prev - 1))}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={templatePage >= templatePagination.totalPages} onClick={() => setTemplatePage((prev) => Math.min(templatePagination.totalPages, prev + 1))}>Next</Button>
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
                <Input value={scheduleSearch} onChange={(event) => setScheduleSearch(event.target.value)} placeholder="Search schedules" className="pl-9" />
              </div>

              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">Group</label>
                <select
                  value={scheduleGroupFilter}
                  onChange={(event) => setScheduleGroupFilter(event.target.value)}
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <option value="">All groups</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">Status</label>
                <select
                  value={scheduleEnabledFilter}
                  onChange={(event) => setScheduleEnabledFilter(event.target.value as 'all' | 'enabled' | 'disabled')}
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <option value="all">All</option>
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>
          </Card>

          {schedulesQuery.isLoading ? (
            <Card className="p-10 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-line/70 border-t-brand-500" />
              <p className="mt-4 text-sm text-muted">Loading schedules...</p>
            </Card>
          ) : schedules.length === 0 ? (
            <Card className="p-10 text-center">
              <Clock3 className="mx-auto h-10 w-10 text-muted" />
              <h3 className="mt-3 text-lg font-semibold text-foreground">No schedules found</h3>
              <p className="mt-1 text-sm text-muted">Create a recurring rollout schedule for any group.</p>
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="bg-panel/70">
                    <tr className="border-b border-line/70 text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Group</th>
                      <th className="px-4 py-3">Template</th>
                      <th className="px-4 py-3">Cron</th>
                      <th className="px-4 py-3">Last Run</th>
                      <th className="px-4 py-3">Runs</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((schedule) => (
                      <tr key={schedule.id} className="border-b border-line/70 hover:bg-panel/35">
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{schedule.name}</span>
                            <span className="text-xs text-muted">{schedule.enabled ? 'Enabled' : 'Disabled'} • {schedule.dryRun ? 'Dry-run' : 'Apply mode'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-foreground">{schedule.group?.name || `#${schedule.groupId}`}</td>
                        <td className="px-4 py-3 text-foreground">{schedule.template?.name || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs text-foreground">{schedule.cronExpression}</div>
                          <div className="text-xs text-muted">{schedule.timezone || 'UTC'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-foreground">{schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString() : 'Never'}</div>
                          <div className="text-xs text-muted">{schedule.lastStatus || '—'}</div>
                        </td>
                        <td className="px-4 py-3 text-foreground">{schedule.runCount}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Button variant="secondary" size="sm" onClick={() => void handleRunSchedule(schedule)} loading={runScheduleMutation.isPending}>
                              <Play className="mr-1.5 h-4 w-4" />
                              Run
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => { setEditingSchedule(schedule); setScheduleEditorOpen(true); }}>
                              Edit
                            </Button>
                            <Button variant="danger" size="sm" onClick={() => void handleDeleteSchedule(schedule)} loading={deleteScheduleMutation.isPending}>
                              <Trash2 className="mr-1.5 h-4 w-4" />
                              Delete
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
              <p className="text-sm text-muted">Page {schedulePagination.page} of {schedulePagination.totalPages}</p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={schedulePage <= 1} onClick={() => setSchedulePage((prev) => Math.max(1, prev - 1))}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={schedulePage >= schedulePagination.totalPages} onClick={() => setSchedulePage((prev) => Math.min(schedulePagination.totalPages, prev + 1))}>Next</Button>
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
                <label className="ml-1 block text-sm font-medium text-muted">Group</label>
                <select
                  value={rolloutGroupFilter}
                  onChange={(event) => setRolloutGroupFilter(event.target.value)}
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <option value="">All groups</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">Status</label>
                <select
                  value={rolloutStatusFilter}
                  onChange={(event) => setRolloutStatusFilter(event.target.value as 'ALL' | 'SUCCESS' | 'FAILED' | 'DRY_RUN')}
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <option value="ALL">All</option>
                  <option value="SUCCESS">SUCCESS</option>
                  <option value="FAILED">FAILED</option>
                  <option value="DRY_RUN">DRY_RUN</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">Source</label>
                <select
                  value={rolloutSourceFilter}
                  onChange={(event) => setRolloutSourceFilter(event.target.value as 'ALL' | 'MANUAL' | 'SCHEDULED')}
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <option value="ALL">All</option>
                  <option value="MANUAL">MANUAL</option>
                  <option value="SCHEDULED">SCHEDULED</option>
                </select>
              </div>
            </div>
          </Card>

          {rolloutsQuery.isLoading ? (
            <Card className="p-10 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-line/70 border-t-brand-500" />
              <p className="mt-4 text-sm text-muted">Loading rollout history...</p>
            </Card>
          ) : rollouts.length === 0 ? (
            <Card className="p-10 text-center">
              <RefreshCw className="mx-auto h-10 w-10 text-muted" />
              <h3 className="mt-3 text-lg font-semibold text-foreground">No rollout history</h3>
              <p className="mt-1 text-sm text-muted">Manual or scheduled policy applications will appear here.</p>
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="bg-panel/70">
                    <tr className="border-b border-line/70 text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Group</th>
                      <th className="px-4 py-3">Template</th>
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Summary</th>
                      <th className="px-4 py-3">Initiated By</th>
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
                                Target: {summary.targetUsers || 0} • Updated: {summary.wouldUpdateUsers || 0} • Skipped: {summary.skippedUsers || 0}
                              </div>
                            ) : (
                              <span className="text-xs text-muted">—</span>
                            )}
                            {rollout.errorMessage ? (
                              <div className="mt-1 text-xs text-red-400">{rollout.errorMessage}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-foreground">{rollout.initiatedBy || 'system'}</td>
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
              <p className="text-sm text-muted">Page {rolloutPagination.page} of {rolloutPagination.totalPages}</p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={rolloutPage <= 1} onClick={() => setRolloutPage((prev) => Math.max(1, prev - 1))}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={rolloutPage >= rolloutPagination.totalPages} onClick={() => setRolloutPage((prev) => Math.min(rolloutPagination.totalPages, prev + 1))}>Next</Button>
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
            ? 'Delete Group'
            : pendingDelete?.type === 'template'
            ? 'Delete Template'
            : pendingDelete?.type === 'schedule'
            ? 'Delete Schedule'
            : ''
        }
        description={
          pendingDelete
            ? `Delete "${pendingDelete.name}"? This action cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
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
