import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { X } from 'lucide-react';

import { useInbounds } from '../../hooks/useInbounds';
import { useCreateUser, useUpdateUser } from '../../hooks/useUsers';
import type { Inbound, User } from '../../types';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';

interface UserFormModalProps {
  user?: User;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormData {
  email: string;
  dataLimit: number;
  expiryDays: number;
  ipLimit: number;
  deviceLimit: number;
  inboundIds: string[];
  note?: string;
}

export function UserFormModal({ user, onClose, onSuccess }: UserFormModalProps) {
  const isEdit = !!user;
  const [submitError, setSubmitError] = useState('');

  const { data: inboundsData } = useInbounds();
  const inbounds: Inbound[] = inboundsData || [];

  const createUser = useCreateUser();
  const updateUser = useUpdateUser();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<FormData>({
    defaultValues: {
      email: '',
      dataLimit: 50,
      expiryDays: 30,
      ipLimit: 0,
      deviceLimit: 0,
      inboundIds: [],
      note: ''
    }
  });

  useEffect(() => {
    if (user) {
      reset({
        email: user.email,
        dataLimit: Number(user.dataLimit) / 1024 ** 3,
        expiryDays: Math.max(
          1,
          Math.ceil((new Date(user.expireDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        ),
        ipLimit: user.ipLimit ?? 0,
        deviceLimit: (user as any).deviceLimit ?? 0,
        inboundIds: user.inbounds?.map((userInbound) => String(userInbound.inboundId)) || [],
        note: user.note || ''
      });
      return;
    }

    reset({
      email: '',
      dataLimit: 50,
      expiryDays: 30,
      ipLimit: 0,
      deviceLimit: 0,
      inboundIds: [],
      note: ''
    });
  }, [user, reset]);

  const onSubmit = async (data: FormData) => {
    setSubmitError('');

    const inboundIds = (data.inboundIds || [])
      .map((value) => Number.parseInt(String(value), 10))
      .filter((value) => Number.isInteger(value) && value > 0);

    const payload = {
      email: data.email,
      dataLimit: Number(data.dataLimit),
      expiryDays: Number(data.expiryDays),
      ipLimit: Number(data.ipLimit),
      deviceLimit: Number(data.deviceLimit),
      inboundIds,
      note: data.note || undefined
    };

    try {
      if (isEdit && user) {
        await updateUser.mutateAsync({
          id: user.id,
          data: payload
        });
      } else {
        await createUser.mutateAsync(payload);
      }
      onSuccess();
    } catch (error: any) {
      setSubmitError(error?.message || 'Failed to save user');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-2 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line/80 bg-card/95 shadow-soft backdrop-blur-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line/80 bg-card/95 p-5">
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">{isEdit ? 'Edit User' : 'Add New User'}</h2>
          <button onClick={onClose} className="rounded-lg p-2 text-muted transition-colors hover:bg-card hover:text-foreground" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 p-5 sm:p-6">
          {submitError ? (
            <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-300">{submitError}</div>
          ) : null}

          <Input
            label="Email *"
            type="email"
            {...register('email', {
              required: 'Email is required',
              pattern: {
                value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                message: 'Invalid email address'
              }
            })}
            error={errors.email?.message}
            placeholder="user@example.com"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="Data Limit (GB) *"
              type="number"
              {...register('dataLimit', {
                valueAsNumber: true,
                required: 'Data limit is required',
                min: { value: 1, message: 'Minimum 1 GB' }
              })}
              error={errors.dataLimit?.message}
              placeholder="50"
            />

            <Input
              label="Expiry Days *"
              type="number"
              {...register('expiryDays', {
                valueAsNumber: true,
                required: 'Expiry days is required',
                min: { value: 1, message: 'Minimum 1 day' }
              })}
              error={errors.expiryDays?.message}
              placeholder="30"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="IP Limit"
              type="number"
              {...register('ipLimit', {
                valueAsNumber: true,
                min: { value: 0, message: 'Must be 0 or greater' }
              })}
              error={errors.ipLimit?.message}
              placeholder="0 = unlimited"
            />

            <Input
              label="Device Limit"
              type="number"
              {...register('deviceLimit', {
                valueAsNumber: true,
                min: { value: 0, message: 'Must be 0 or greater' }
              })}
              error={(errors as any).deviceLimit?.message}
              placeholder="0 = unlimited"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-muted">Inbounds *</label>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-line/80 bg-panel/55 p-3">
              {inbounds.length === 0 ? (
                <p className="text-sm text-muted">No inbounds available. Create one first.</p>
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
                        validate: (values) => (values && values.length > 0) || 'Select at least one inbound'
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

          <Input label="Note" {...register('note')} placeholder="Optional note about this user" />

          <div className="sticky bottom-0 flex flex-col gap-2 border-t border-line/70 bg-card/95 pt-4 sm:flex-row">
            <Button type="submit" className="flex-1" loading={createUser.isPending || updateUser.isPending}>
              {isEdit ? 'Update User' : 'Create User'}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
