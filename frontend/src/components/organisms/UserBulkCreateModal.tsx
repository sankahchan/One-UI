import React, { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Download, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useInbounds } from '../../hooks/useInbounds';
import { useBulkCreateUsers } from '../../hooks/useUsers';
import type { BulkCreateUsersData, BulkCreateUsersResult } from '../../api/users';
import type { Inbound } from '../../types';
import { useToast } from '../../hooks/useToast';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';

interface UserBulkCreateModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

interface BulkFormData extends Omit<BulkCreateUsersData, 'inboundIds'> {
  inboundIds: Array<string | number>;
}

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function downloadCredentialsCsv(result: BulkCreateUsersResult) {
  if (!Array.isArray(result.users) || result.users.length === 0) {
    return;
  }

  const rows = [
    ['Email', 'UUID', 'Password', 'Subscription Token', 'Expire Date', 'Status'].map(csvCell).join(','),
    ...result.users.map((user) =>
      [user.email, user.uuid, user.password, user.subscriptionToken, user.expireDate, user.status]
        .map(csvCell)
        .join(',')
    )
  ];

  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `bulk-users-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
  link.click();
  window.URL.revokeObjectURL(url);
}

function buildPreviewEmails(prefix: string, domain: string, count: number, startIndex: number, padding: number) {
  const safePrefix = prefix.trim();
  const safeDomain = domain.trim().replace(/^@+/, '');
  const safeCount = Number.isInteger(count) ? Math.max(0, Math.min(count, 5)) : 0;
  const safeStart = Number.isInteger(startIndex) ? Math.max(1, startIndex) : 1;
  const safePadding = Number.isInteger(padding) ? Math.max(0, padding) : 0;

  if (!safePrefix || !safeDomain || safeCount === 0) {
    return [];
  }

  return Array.from({ length: safeCount }, (_, offset) => {
    const index = safeStart + offset;
    const suffix = safePadding > 0 ? String(index).padStart(safePadding, '0') : String(index);
    return `${safePrefix}${suffix}@${safeDomain}`;
  });
}

export const UserBulkCreateModal: React.FC<UserBulkCreateModalProps> = ({ onClose, onSuccess }) => {
  const toast = useToast();
  const { t } = useTranslation();
  const { data: inboundsData } = useInbounds();
  const bulkCreateMutation = useBulkCreateUsers();

  const inbounds = (inboundsData || []).filter((inbound: Inbound) => inbound.enabled !== false) as Inbound[];

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors }
  } = useForm<BulkFormData>({
    defaultValues: {
      prefix: 'user',
      domain: 'example.com',
      count: 10,
      startIndex: 1,
      padding: 2,
      dataLimit: 50,
      expiryDays: 30,
      inboundIds: [],
      ipLimit: 0,
      status: 'ACTIVE'
    }
  });

  const prefix = watch('prefix');
  const domain = watch('domain');
  const count = Number(watch('count'));
  const startIndex = Number(watch('startIndex'));
  const padding = Number(watch('padding'));

  const previewEmails = useMemo(
    () => buildPreviewEmails(prefix || '', domain || '', count, startIndex, padding),
    [prefix, domain, count, startIndex, padding]
  );

  const onSubmit = async (values: BulkFormData) => {
    try {
      const payload: BulkCreateUsersData = {
        ...values,
        inboundIds: (values.inboundIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0),
        count: Number(values.count),
        startIndex: Number(values.startIndex),
        padding: Number(values.padding),
        dataLimit: Number(values.dataLimit),
        expiryDays: Number(values.expiryDays),
        ipLimit: Number(values.ipLimit)
      };

      const result = await bulkCreateMutation.mutateAsync(payload);
      downloadCredentialsCsv(result);

      const failurePreview = (result.failed || [])
        .slice(0, 5)
        .map((entry) => `${entry.email}: ${entry.reason}`)
        .join('\n');

      const summaryParts = [
        t('users.bulkCreate.toast.requested', { defaultValue: 'Requested: {{count}}', count: result.requestedCount }),
        t('users.bulkCreate.toast.created', { defaultValue: 'Created: {{count}}', count: result.createdCount }),
        t('users.bulkCreate.toast.failed', { defaultValue: 'Failed: {{count}}', count: result.failedCount }),
        result.createdCount > 0 ? t('users.bulkCreate.toast.csvDownloaded', { defaultValue: 'Credentials CSV downloaded.' }) : undefined
      ].filter(Boolean);

      toast.success(t('common.success', { defaultValue: 'Success' }), summaryParts.join(' • '));
      if (failurePreview) {
        toast.warning(t('common.warning', { defaultValue: 'Warning' }), failurePreview);
      }

      if (result.createdCount > 0) {
        onSuccess();
      }
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.bulkCreate.toast.failedBody', { defaultValue: 'Failed to create users in bulk' })
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-2 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="my-6 w-full max-w-3xl overflow-hidden rounded-2xl border border-line/80 bg-card/95 shadow-soft">
        <div className="flex items-center justify-between border-b border-line/80 p-5">
          <div>
            <h2 className="text-xl font-bold text-foreground sm:text-2xl">
              {t('users.bulkCreate.title', { defaultValue: 'Bulk User Provisioning' })}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t('users.bulkCreate.subtitle', { defaultValue: 'Create multiple users with consistent limits and inbound assignments.' })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-card hover:text-foreground"
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 p-5 sm:p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label={`${t('users.bulkCreate.prefixLabel', { defaultValue: 'Email Prefix' })} *`}
              {...register('prefix', { required: t('users.bulkCreate.validation.prefixRequired', { defaultValue: 'Prefix is required' }) })}
              error={errors.prefix?.message}
              placeholder="user"
            />
            <Input
              label={`${t('users.bulkCreate.domainLabel', { defaultValue: 'Domain' })} *`}
              {...register('domain', { required: t('users.bulkCreate.validation.domainRequired', { defaultValue: 'Domain is required' }) })}
              error={errors.domain?.message}
              placeholder="example.com"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Input
              label={`${t('users.bulkCreate.countLabel', { defaultValue: 'Count' })} *`}
              type="number"
              {...register('count', {
                valueAsNumber: true,
                required: t('users.bulkCreate.validation.countRequired', { defaultValue: 'Count is required' }),
                min: { value: 1, message: t('users.bulkCreate.validation.countMin', { defaultValue: 'Minimum 1' }) },
                max: { value: 200, message: t('users.bulkCreate.validation.countMax', { defaultValue: 'Maximum 200' }) }
              })}
              error={errors.count?.message}
            />
            <Input
              label={`${t('users.bulkCreate.startIndexLabel', { defaultValue: 'Start Index' })} *`}
              type="number"
              {...register('startIndex', {
                valueAsNumber: true,
                required: t('users.bulkCreate.validation.startIndexRequired', { defaultValue: 'Start index is required' }),
                min: { value: 1, message: t('users.bulkCreate.validation.countMin', { defaultValue: 'Minimum 1' }) }
              })}
              error={errors.startIndex?.message}
            />
            <Input
              label={t('users.bulkCreate.paddingLabel', { defaultValue: 'Padding' })}
              type="number"
              {...register('padding', {
                valueAsNumber: true,
                min: { value: 0, message: t('users.quickEdit.validation.minZero', { defaultValue: 'Minimum 0' }) },
                max: { value: 8, message: t('users.bulkCreate.validation.paddingMax', { defaultValue: 'Maximum 8' }) }
              })}
              error={errors.padding?.message}
            />
          </div>

          <div className="rounded-xl border border-line/70 bg-panel/55 p-4">
            <p className="text-sm font-semibold text-foreground">{t('users.bulkCreate.previewTitle', { defaultValue: 'Email Preview' })}</p>
            {previewEmails.length === 0 ? (
              <p className="mt-1 text-xs text-muted">
                {t('users.bulkCreate.previewEmpty', { defaultValue: 'Enter prefix/domain to preview generated emails.' })}
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {previewEmails.map((email) => (
                  <li key={email}>{email}</li>
                ))}
                {count > previewEmails.length ? <li>...</li> : null}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Input
              label={`${t('users.form.dataLimitLabel', { defaultValue: 'Data Limit (GB)' })} *`}
              type="number"
              {...register('dataLimit', {
                valueAsNumber: true,
                required: t('users.form.validation.dataLimitRequired', { defaultValue: 'Data limit is required' }),
                min: { value: 0, message: t('users.quickEdit.validation.minZero', { defaultValue: 'Minimum 0' }) }
              })}
              error={errors.dataLimit?.message}
            />
            <Input
              label={`${t('users.expiryDays', { defaultValue: 'Expiry Days' })} *`}
              type="number"
              {...register('expiryDays', {
                valueAsNumber: true,
                required: t('users.form.validation.expiryDaysRequired', { defaultValue: 'Expiry days is required' }),
                min: { value: 1, message: t('users.form.validation.minDay', { defaultValue: 'Minimum 1 day' }) }
              })}
              error={errors.expiryDays?.message}
            />
            <Input
              label={t('users.form.ipLimitLabel', { defaultValue: 'IP Limit' })}
              type="number"
              {...register('ipLimit', {
                valueAsNumber: true,
                min: { value: 0, message: t('users.quickEdit.validation.minZero', { defaultValue: 'Minimum 0' }) }
              })}
              error={errors.ipLimit?.message}
              placeholder={t('users.ipLimitHint', { defaultValue: '0 = unlimited' })}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-muted">{t('common.status', { defaultValue: 'Status' })}</label>
              <select
                {...register('status')}
                className="w-full rounded-xl border border-line/80 bg-card/75 px-3 py-2 text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/35"
              >
                <option value="ACTIVE">{t('status.active', { defaultValue: 'Active' })}</option>
                <option value="LIMITED">{t('status.limited', { defaultValue: 'Limited' })}</option>
                <option value="DISABLED">{t('status.disabled', { defaultValue: 'Disabled' })}</option>
                <option value="EXPIRED">{t('status.expired', { defaultValue: 'Expired' })}</option>
              </select>
            </div>

            <Input
              label={t('users.note', { defaultValue: 'Note' })}
              {...register('note')}
              placeholder={t('users.bulkCreate.notePlaceholder', { defaultValue: 'Optional note applied to all created users' })}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-muted">
              {t('users.bulkCreate.assignInboundsLabel', { defaultValue: 'Assign Inbounds' })} *
            </label>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-line/80 bg-card/65 p-3">
              {inbounds.length === 0 ? (
                <p className="text-sm text-muted">
                  {t('users.bulkCreate.noActiveInbounds', { defaultValue: 'No active inbounds available.' })}
                </p>
              ) : (
                inbounds.map((inbound) => (
                  <label key={inbound.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-card/80">
                    <input
                      type="checkbox"
                      value={inbound.id}
                      {...register('inboundIds', {
                        required: t('users.form.validation.inboundRequired', { defaultValue: 'Select at least one inbound' })
                      })}
                      className="h-4 w-4 rounded border-line bg-card"
                    />
                    <span className="text-sm text-foreground">
                      {inbound.protocol} - {inbound.remark || `Port ${inbound.port}`}
                    </span>
                  </label>
                ))
              )}
            </div>
            {errors.inboundIds ? <p className="mt-1 text-sm text-red-500">{errors.inboundIds.message as string}</p> : null}
          </div>

          <div className="flex flex-col gap-2 border-t border-line/70 pt-4 sm:flex-row">
            <Button type="submit" className="flex-1" loading={bulkCreateMutation.isPending}>
              <Download className="mr-2 h-4 w-4" />
              {t('users.bulkCreate.submit', { defaultValue: 'Create Users & Download Credentials' })}
            </Button>
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
