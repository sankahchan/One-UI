import { Cable, Gauge, Layers3, Settings, Users } from 'lucide-react';
import { NavLink } from 'react-router-dom';

import { cn } from '../../utils/cn';

const items = [
  { to: '/dashboard', label: 'Dashboard', icon: Gauge },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/groups', label: 'Groups', icon: Layers3 },
  { to: '/inbounds', label: 'Inbounds', icon: Cable },
  { to: '/settings', label: 'Settings', icon: Settings }
];

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-slate-700/60 bg-surface-900/80 p-4 lg:block">
      <nav className="space-y-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive ? 'bg-accent-500/20 text-accent-500' : 'text-slate-300 hover:bg-surface-700/80 hover:text-slate-100'
              )
            }
            to={item.to}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
