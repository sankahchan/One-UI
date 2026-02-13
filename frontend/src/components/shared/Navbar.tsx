import { LogOut, ShieldCheck } from 'lucide-react';

import { useAuth } from '../../hooks/useAuth';
import { Button } from '../atoms/Button';

export function Navbar() {
  const { admin, logoutMutation } = useAuth();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-700/60 bg-surface-900/90 px-4 backdrop-blur md:px-6">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-accent-500/20 p-2 text-accent-500">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-100">ONE-UI</p>
          <p className="text-xs text-slate-400">Admin Dashboard</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <p className="hidden text-sm text-slate-300 md:block">{admin?.username ?? 'admin'}</p>
        <Button
          variant="ghost"
          onClick={() => {
            logoutMutation.mutate();
          }}
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
