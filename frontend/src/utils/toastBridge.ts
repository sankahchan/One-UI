import type { ToastContextValue } from '../components/shared/toast-context';

let toastRef: ToastContextValue | null = null;

export function registerToast(ctx: ToastContextValue): void {
  toastRef = ctx;
}

export function getToast(): ToastContextValue | null {
  return toastRef;
}
