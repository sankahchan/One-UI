import { useMemo } from 'react';
import { useForm } from 'react-hook-form';

import type { User, UserCreatePayload, UserStatus, UserUpdatePayload } from '../../types';
import { isValidEmail } from '../../utils/validators';
import { Button } from '../atoms/Button';
import { Card } from '../atoms/Card';
import { Input } from '../atoms/Input';

interface UserFormProps {
  initialUser?: User;
  loading?: boolean;
  submitLabel: string;
  onSubmit: (payload: UserCreatePayload | UserUpdatePayload) => Promise<void> | void;
}

interface UserFormValues {
  email: string;
  dataLimit: number;
  expiryDays: number;
  note: string;
  inboundIds: string;
  status: UserStatus;
}

const STATUS_OPTIONS: UserStatus[] = ['ACTIVE', 'LIMITED', 'DISABLED', 'EXPIRED'];

export function UserForm({ initialUser, loading = false, submitLabel, onSubmit }: UserFormProps) {
  const defaultValues = useMemo<UserFormValues>(() => {
    const inboundIds = initialUser?.inbounds?.map((item) => item.inboundId).join(', ') ?? '';

    return {
      email: initialUser?.email ?? '',
      dataLimit: initialUser ? Number(initialUser.dataLimit) / 1024 / 1024 / 1024 : 50,
      expiryDays: initialUser?.daysRemaining ?? 30,
      note: initialUser?.note ?? '',
      inboundIds,
      status: initialUser?.status ?? 'ACTIVE'
    };
  }, [initialUser]);

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<UserFormValues>({
    defaultValues
  });

  return (
    <Card>
      <h3 className="mb-4 text-base font-semibold text-slate-900">{initialUser ? 'Update User' : 'Create User'}</h3>
      <form
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
        onSubmit={handleSubmit(async (values) => {
          const inboundIds = values.inboundIds
            .split(',')
            .map((item) => Number.parseInt(item.trim(), 10))
            .filter((item) => Number.isInteger(item) && item > 0);

          const payload: UserCreatePayload | UserUpdatePayload = initialUser
            ? {
                email: values.email,
                dataLimit: values.dataLimit,
                expiryDays: values.expiryDays,
                note: values.note,
                inboundIds,
                status: values.status
              }
            : {
                email: values.email,
                dataLimit: values.dataLimit,
                expiryDays: values.expiryDays,
                note: values.note,
                inboundIds
              };

          await onSubmit(payload);
        })}
      >
        <Input
          label="Email"
          error={errors.email?.message}
          {...register('email', {
            validate: (value) => isValidEmail(value) || 'Enter a valid email'
          })}
        />
        <Input
          type="number"
          min={1}
          label="Data Limit (GB)"
          error={errors.dataLimit?.message}
          {...register('dataLimit', {
            valueAsNumber: true,
            min: {
              value: 1,
              message: 'Data limit must be at least 1 GB'
            }
          })}
        />
        <Input
          type="number"
          min={1}
          label="Expiry (days)"
          error={errors.expiryDays?.message}
          {...register('expiryDays', {
            valueAsNumber: true,
            min: {
              value: 1,
              message: 'Expiry must be at least 1 day'
            }
          })}
        />
        <Input label="Inbound IDs (comma-separated)" {...register('inboundIds')} />
        <Input className="md:col-span-2" label="Note" {...register('note')} />

        {initialUser ? (
          <label className="flex flex-col gap-2 text-sm text-slate-300">
            <span className="font-medium text-slate-200">Status</span>
            <select
              className="rounded-lg border border-slate-700 bg-surface-800 px-3 py-2 text-slate-100 focus:border-accent-500 focus:outline-none"
              {...register('status')}
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="md:col-span-2">
          <Button className="w-full" loading={loading} type="submit">
            {submitLabel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
