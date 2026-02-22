import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useInbounds } from '../../hooks/useInbounds';
import { useCreateUser, useUpdateUser } from '../../hooks/useUsers';
import type { Inbound, User } from '../../types';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';

interface UserFormModalProps {
  user?: User;
  onClose: () => void;
  onSuccess: (createdUser?: User) => void;
}

interface FormData {
  email: string;
  name: string;
  dataLimit: number;
  expiryDays: number;
  startOnFirstUse: boolean;
  ipLimit: number;
  deviceLimit: number;
  inboundIds: string[];
  note?: string;
}

export function UserFormModal({ user, onClose, onSuccess }: UserFormModalProps) {
  const isEdit = !!user;
  const [submitError, setSubmitError] = useState('');
  const [identityMode, setIdentityMode] = useState<'name' | 'email'>('name');
  const { t } = useTranslation();
  const navigate = useNavigate();
  const generatedDomain = 'one-ui.local';

  const { data: inboundsData } = useInbounds();
  const inbounds: Inbound[] = inboundsData || [];

  const createUser = useCreateUser();
  const updateUser = useUpdateUser();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    clearErrors,
    formState: { errors }
  } = useForm<FormData>({
    defaultValues: {
      email: '',
      name: '',
      dataLimit: 50,
      expiryDays: 30,
      startOnFirstUse: false,
      ipLimit: 0,
      deviceLimit: 0,
      inboundIds: [],
      note: ''
    }
  });

  useEffect(() => {
    if (user) {
      setIdentityMode('email');
      const msPerDay = 1000 * 60 * 60 * 24;
      const isDeferredExpiry = Boolean(user.startOnFirstUse) && !user.firstUsedAt;
      const expiryDaysValue = isDeferredExpiry
        ? Math.max(
          1,
          Math.ceil(
            (new Date(user.expireDate).getTime() - new Date(user.createdAt).getTime()) / msPerDay
          )
        )
        : Math.max(1, Math.ceil((new Date(user.expireDate).getTime() - Date.now()) / msPerDay));

      reset({
        email: user.email,
        name: '',
        dataLimit: Number(user.dataLimit) / 1024 ** 3,
        expiryDays: expiryDaysValue,
        startOnFirstUse: Boolean(user.startOnFirstUse),
        ipLimit: user.ipLimit ?? 0,
        deviceLimit: (user as any).deviceLimit ?? 0,
        inboundIds: user.inbounds?.map((userInbound) => String(userInbound.inboundId)) || [],
        note: user.note || ''
      });
      return;
    }

    setIdentityMode('name');
    reset({
      email: '',
      name: '',
      dataLimit: 50,
      expiryDays: 30,
      startOnFirstUse: false,
      ipLimit: 0,
      deviceLimit: 0,
      inboundIds: [],
      note: ''
    });
  }, [user, reset]);

  const buildRandomSlug = () => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';
    for (let index = 0; index < 8; index += 1) {
      value += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return value;
  };

  useEffect(() => {
    if (isEdit) {
      return;
    }
    setValue('name', buildRandomSlug(), { shouldDirty: false, shouldTouch: false, shouldValidate: false });
  }, [isEdit, setValue]);

  const normalizeName = (value: string): string =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9._-]/g, '')
      .replace(/[-._]{2,}/g, '-')
      .replace(/^[-._]+|[-._]+$/g, '')
      .slice(0, 32);

  const generateIdentity = () => {
    const next = buildRandomSlug();

    if (identityMode === 'name') {
      setValue('name', next, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
      clearErrors('name');
      return;
    }

    setValue('email', `${next}@${generatedDomain}`, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    clearErrors('email');
  };

  const identityName = watch('name');
  const identityPreviewEmail = normalizeName(identityName)
    ? `${normalizeName(identityName)}@${generatedDomain}`
    : '';

  const onSubmit = async (data: FormData) => {
    setSubmitError('');

    const inboundIds = (data.inboundIds || [])
      .map((value) => Number.parseInt(String(value), 10))
      .filter((value) => Number.isInteger(value) && value > 0);

    const normalizedName = normalizeName(data.name);
    const identityEmail =
      !isEdit && identityMode === 'name'
        ? normalizedName
          ? `${normalizedName}@${generatedDomain}`
          : ''
        : String(data.email || '').trim();

    if (!identityEmail) {
      setSubmitError(
        identityMode === 'name'
          ? t('users.form.validation.nameRequired', { defaultValue: 'Name is required' })
          : t('users.form.validation.emailRequired', { defaultValue: 'Email is required' })
      );
      return;
    }

    if (inboundIds.length === 0) {
      setSubmitError(
        t('users.form.validation.inboundRequired', { defaultValue: 'Select at least one inbound' })
      );
      return;
    }

    const payload: Record<string, unknown> = {
      email: identityEmail,
      dataLimit: Number(data.dataLimit),
      expiryDays: Number(data.expiryDays),
      ipLimit: Number(data.ipLimit),
      deviceLimit: Number(data.deviceLimit),
      inboundIds,
      note: data.note || undefined
    };

    if (!isEdit) {
      payload.startOnFirstUse = Boolean(data.startOnFirstUse);
    }

    try {
      if (isEdit && user) {
        await updateUser.mutateAsync({
          id: user.id,
          data: payload
        });
        onSuccess();
      } else {
        const response = await createUser.mutateAsync(payload as any);
        onSuccess(response.data);
      }
    } catch (error: any) {
      setSubmitError(error?.message || t('users.form.saveFailed', { defaultValue: 'Failed to save user' }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-2 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line/80 bg-card/95 shadow-soft backdrop-blur-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line/80 bg-card/95 p-5">
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">
            {isEdit ? t('users.editUser', { defaultValue: 'Edit User' }) : t('users.addUser', { defaultValue: 'Add User' })}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-card hover:text-foreground"
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 p-5 sm:p-6">
          {submitError ? (
            <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-300">{submitError}</div>
          ) : null}

          {!isEdit ? (
            <div className="space-y-2 rounded-xl border border-line/70 bg-panel/40 p-3">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
                {t('users.form.identityMode', { defaultValue: 'Identity input' })}
              </p>
              <div className="inline-flex rounded-lg border border-line/70 bg-card/70 p-1">
                <button
                  type="button"
                  onClick={() => setIdentityMode('name')}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    identityMode === 'name'
                      ? 'bg-brand-500 text-white'
                      : 'text-muted hover:bg-card hover:text-foreground'
                  }`}
                >
                  {t('users.form.useName', { defaultValue: 'Name' })}
                </button>
                <button
                  type="button"
                  onClick={() => setIdentityMode('email')}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    identityMode === 'email'
                      ? 'bg-brand-500 text-white'
                      : 'text-muted hover:bg-card hover:text-foreground'
                  }`}
                >
                  {t('users.form.useEmail', { defaultValue: 'Email' })}
                </button>
              </div>
            </div>
          ) : null}

          {!isEdit && identityMode === 'name' ? (
            <div className="space-y-1.5">
              <label className="ml-1 block text-sm font-medium text-muted">
                {`${t('users.form.nameLabel', { defaultValue: 'Name' })} *`}
              </label>
              <div className="relative">
                <input
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 pr-24 text-sm text-foreground outline-none transition-all duration-200 placeholder:text-muted focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-app sm:text-base"
                  placeholder={t('users.form.namePlaceholder', { defaultValue: 'client001' })}
                  {...register('name', {
                    validate: (value) => {
                      if (isEdit || identityMode !== 'name') {
                        return true;
                      }
                      if (!String(value || '').trim()) {
                        return t('users.form.validation.nameRequired', { defaultValue: 'Name is required' });
                      }
                      if (!/^[A-Za-z0-9._\-\s]{3,32}$/.test(String(value || ''))) {
                        return t('users.form.validation.nameInvalid', {
                          defaultValue: 'Use 3-32 letters, numbers, dots, dashes, or underscores'
                        });
                      }
                      return true;
                    }
                  })}
                />
                <button
                  type="button"
                  onClick={generateIdentity}
                  className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-lg border border-line/70 bg-card/90 px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-panel"
                  aria-label={t('users.form.generateName', { defaultValue: 'Generate name' })}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t('users.form.generate', { defaultValue: 'Generate' })}
                </button>
              </div>
              {errors.name ? <p className="ml-1 text-sm text-red-500 dark:text-red-300">{errors.name.message}</p> : null}
              <p className="ml-1 text-xs text-muted">
                {t('users.form.generatedEmailPreview', {
                  defaultValue: 'Stored email: {{email}}',
                  email: identityPreviewEmail || `name@${generatedDomain}`
                })}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="ml-1 block text-sm font-medium text-muted">
                {`${t('users.email', { defaultValue: 'Email' })} *`}
              </label>
              <div className="relative">
                <input
                  type="email"
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 pr-24 text-sm text-foreground outline-none transition-all duration-200 placeholder:text-muted focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-app sm:text-base"
                  placeholder="user@example.com"
                  {...register('email', {
                    validate: (value) => {
                      if (!isEdit && identityMode !== 'email') {
                        return true;
                      }
                      const normalized = String(value || '').trim();
                      if (!normalized) {
                        return t('users.form.validation.emailRequired', { defaultValue: 'Email is required' });
                      }
                      if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(normalized)) {
                        return t('users.form.validation.emailInvalid', { defaultValue: 'Invalid email address' });
                      }
                      return true;
                    }
                  })}
                />
                {!isEdit ? (
                  <button
                    type="button"
                    onClick={generateIdentity}
                    className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-lg border border-line/70 bg-card/90 px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-panel"
                    aria-label={t('users.form.generateEmail', { defaultValue: 'Generate email' })}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t('users.form.generate', { defaultValue: 'Generate' })}
                  </button>
                ) : null}
              </div>
              {errors.email ? <p className="ml-1 text-sm text-red-500 dark:text-red-300">{errors.email.message}</p> : null}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label={`${t('users.form.dataLimitLabel', { defaultValue: 'Data Limit (GB)' })} *`}
              type="number"
              {...register('dataLimit', {
                valueAsNumber: true,
                required: t('users.form.validation.dataLimitRequired', { defaultValue: 'Data limit is required' }),
                min: { value: 1, message: t('users.form.validation.minGb', { defaultValue: 'Minimum 1 GB' }) }
              })}
              error={errors.dataLimit?.message}
              placeholder="50"
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
              placeholder="30"
            />
          </div>

          {!isEdit ? (
            <div className="rounded-xl border border-line/70 bg-panel/40 p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  {...register('startOnFirstUse')}
                  className="mt-1 h-4 w-4 rounded border-line text-brand-500 focus:ring-brand-500/40"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {t('users.form.startOnFirstUseTitle', { defaultValue: 'Start expiry on first connect' })}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {t('users.form.startOnFirstUseDescription', {
                      defaultValue:
                        'The expiry timer begins when the user first connects (downloads subscription). Until then, the account stays active.'
                    })}
                  </p>
                </div>
              </label>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label={t('users.form.ipLimitLabel', { defaultValue: 'IP Limit' })}
              type="number"
              {...register('ipLimit', {
                valueAsNumber: true,
                min: { value: 0, message: t('users.form.validation.minZero', { defaultValue: 'Must be 0 or greater' }) }
              })}
              error={errors.ipLimit?.message}
              placeholder={t('users.ipLimitHint', { defaultValue: '0 = unlimited' })}
            />

            <Input
              label={t('users.form.deviceLimitLabel', { defaultValue: 'Device Limit' })}
              type="number"
              {...register('deviceLimit', {
                valueAsNumber: true,
                min: { value: 0, message: t('users.form.validation.minZero', { defaultValue: 'Must be 0 or greater' }) }
              })}
              error={(errors as any).deviceLimit?.message}
              placeholder={t('users.ipLimitHint', { defaultValue: '0 = unlimited' })}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-muted">
              {t('inbounds.title', { defaultValue: 'Inbounds' })} *
            </label>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-line/80 bg-panel/55 p-3">
              {inbounds.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted">
                    {t('users.form.noInboundsHint', { defaultValue: 'No inbounds available. Create one first.' })}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      onClose();
                      navigate('/inbounds');
                    }}
                  >
                    {t('inbounds.addInbound', { defaultValue: 'Add Inbound' })}
                  </Button>
                </div>
              ) : (
                inbounds.map((inbound) => (
                  <label
                    key={inbound.id}
                    className="flex cursor-pointer items-center space-x-3 rounded-lg p-2.5 transition hover:bg-card"
                  >
                    <input
                      type="checkbox"
                      value={inbound.id}
                      {...register('inboundIds', {
                        validate: (values) =>
                          (values && values.length > 0) || t('users.form.validation.inboundRequired', { defaultValue: 'Select at least one inbound' })
                      })}
                      className="h-4 w-4 rounded border-line text-brand-500 focus:ring-brand-500/40"
                    />
                    <span className="text-sm text-foreground">
                      {inbound.protocol} - {inbound.remark || `Port ${inbound.port}`}
                    </span>
                  </label>
                ))
              )}
            </div>
            {errors.inboundIds ? <p className="mt-1 text-sm text-red-500 dark:text-red-300">{errors.inboundIds.message}</p> : null}
          </div>

          <Input
            label={t('users.note', { defaultValue: 'Note' })}
            {...register('note')}
            placeholder={t('users.form.notePlaceholder', { defaultValue: 'Optional note about this user' })}
          />

          <div className="sticky bottom-0 flex flex-col gap-2 border-t border-line/70 bg-card/95 pt-4 sm:flex-row">
            <Button
              type="submit"
              className="flex-1"
              loading={createUser.isPending || updateUser.isPending}
              disabled={inbounds.length === 0}
            >
              {isEdit
                ? t('users.form.updateUser', { defaultValue: 'Update User' })
                : t('users.form.createUser', { defaultValue: 'Create User' })}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
