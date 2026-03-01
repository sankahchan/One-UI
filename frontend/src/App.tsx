import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { useTheme } from './hooks/useTheme';
import { useMarzbanSocket } from './hooks/useMarzbanSocket';
import { useAuthStore } from './store/authStore';
import { ToastProvider } from './components/shared/ToastProvider';
import { queryClient } from './lib/queryClient';

const isMarzban = import.meta.env.VITE_MARZBAN_INTEGRATION === 'true';

const DashboardLayout = lazy(() =>
  import('./components/templates/DashboardLayout').then((module) => ({ default: module.DashboardLayout }))
);
const Login = lazy(() => import('./pages/Login').then((module) => ({ default: module.Login })));

const Dashboard = lazy(() =>
  isMarzban
    ? import('./pages/MarzbanDashboard').then((module) => ({ default: module.DashboardPage }))
    : import('./pages/Dashboard').then((module) => ({ default: module.DashboardPage }))
);
const Users = lazy(() =>
  isMarzban
    ? import('./pages/MarzbanUsers').then((module) => ({ default: module.UsersPage }))
    : import('./pages/Users').then((module) => ({ default: module.UsersPage }))
);
const Groups = lazy(() => import('./pages/Groups').then((module) => ({ default: module.Groups })));
const UserDetail = lazy(() => import('./pages/UserDetail').then((module) => ({ default: module.UserDetail })));
const Inbounds = lazy(() => import('./pages/Inbounds').then((module) => ({ default: module.Inbounds })));
const Mieru = lazy(() => import('./pages/Mieru').then((module) => ({ default: module.MieruPage })));
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));
const UserInfoPage = lazy(() =>
  import('./pages/UserInfoPage').then((module) => ({ default: module.UserInfoPage }))
);
const MieruSharePage = lazy(() =>
  import('./pages/MieruSharePage').then((module) => ({ default: module.MieruSharePage }))
);

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const RouteLoader: React.FC = () => (
  <div className="flex min-h-screen items-center justify-center">
    <div className="h-10 w-10 animate-spin rounded-full border-4 border-line/80 border-t-brand-500" />
  </div>
);

const configuredPanelBasePath =
  (import.meta.env.VITE_PANEL_PATH as string | undefined)?.replace(/\/+$/, '') || '';

const detectRuntimePanelBasePath = () => {
  if (configuredPanelBasePath) {
    return configuredPanelBasePath;
  }

  if (typeof window === 'undefined') {
    return '';
  }

  const knownTopLevelRoutes = new Set([
    'login',
    'dashboard',
    'users',
    'groups',
    'inbounds',
    'mieru',
    'settings',
    'mieru-share',
    'user',
    'sub',
    'api',
    'uploads',
    'dns-query'
  ]);

  const firstSegment = window.location.pathname.split('/').filter(Boolean)[0];
  if (!firstSegment || knownTopLevelRoutes.has(firstSegment)) {
    return '';
  }

  return `/${firstSegment}`;
};

const panelBasePath = detectRuntimePanelBasePath();

const AppRoutes: React.FC = () => {
  // Initializes and keeps the selected/system theme synced with the root element.
  useTheme();
  useMarzbanSocket();

  return (
    <BrowserRouter basename={panelBasePath}>
      <Suspense fallback={<RouteLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/user/:token" element={<UserInfoPage />} />
          <Route path="/user/:token/mieru" element={<UserInfoPage />} />
          <Route path="/mieru-share/:token/page" element={<MieruSharePage />} />

          <Route
            path="/"
            element={(
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            )}
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="users" element={<Users />} />
            <Route path="groups" element={<Groups />} />
            <Route path="groups/:id" element={<Groups />} />
            <Route path="users/:id" element={<UserDetail />} />
            <Route path="inbounds" element={<Inbounds />} />
            <Route path="mieru" element={<Mieru />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
