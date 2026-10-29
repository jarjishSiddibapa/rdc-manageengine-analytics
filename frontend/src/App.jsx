import { lazy, Suspense, useEffect, useMemo } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import { AuthProvider, useAuth } from './context/Auth';
import { AppConfigProvider, useAppConfig } from './context/AppConfig';
import { FiltersProvider } from './context/Filters';
import { SyncProvider } from './context/Sync';
import { SRViewerProvider } from './context/SRViewer';
import { LoadingNotice } from './components/ui/LoadingNotice';
import { ErrorBoundary, ErrorState } from './components/ui/ErrorState';
import useMedia, { useIsMobile } from './hooks/useMedia';
import AppShell from './layout/AppShell';
import Login from './pages/Login';
import { BRAND, FONT } from './theme';

// Each screen is its own download, fetched when first opened (and the rest quietly once the app is idle), so the first screen is light.
const loaders = {
  dashboard: () => import('./pages/Dashboard'),
  technicians: () => import('./pages/Technicians'),
  profile: () => import('./pages/TechnicianProfile'),
  srs: () => import('./pages/SRs'),
  sync: () => import('./pages/DataSync'),
  admin: () => import('./pages/Admin'),
  account: () => import('./pages/Account'),
};
const Dashboard = lazy(loaders.dashboard);
const Technicians = lazy(loaders.technicians);
const TechnicianProfile = lazy(loaders.profile);
const SRs = lazy(loaders.srs);
const DataSync = lazy(loaders.sync);
const Admin = lazy(loaders.admin);
const Account = lazy(loaders.account);
const ForgotPassword = lazy(() => import('./pages/PasswordReset').then(m => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import('./pages/PasswordReset').then(m => ({ default: m.ResetPassword })));
const ForcedPasswordChange = lazy(() => loaders.account().then(m => ({ default: m.ForcedPasswordChange })));

function Guard({ allow, children }) {
  const { user } = useAuth();
  return allow(user) ? children : <Navigate to="/" replace />;
}

function usePrefetch(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    const idle = window.requestIdleCallback || (cb => setTimeout(cb, 1500));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const handle = idle(() => { Object.values(loaders).forEach(load => load().catch(() => {})); }, { timeout: 4000 });
    return () => cancel(handle);
  }, [enabled]);
}

function Routed() {
  const { user, loading, bootError, retryBoot } = useAuth();
  usePrefetch(!!user && !user.must_change_password);
  const { pathname } = useLocation();
  const { config } = useAppConfig();
  if (loading) return <LoadingNotice fullPage label="Starting..." />;
  if (bootError) return <div style={{ padding: 16 }}><ErrorState title="Cannot reach the server" message={bootError} onRetry={retryBoot} /></div>;
  // The password-reset pages open from an emailed link, whoever (or nobody) is signed in.
  if (pathname === '/reset-password') return <Suspense fallback={<LoadingNotice fullPage />}><ResetPassword /></Suspense>;
  if (!user && pathname === '/forgot-password' && config.password_reset) return <Suspense fallback={<LoadingNotice fullPage />}><ForgotPassword /></Suspense>;
  if (!user) return <Login />;
  if (user.must_change_password) return <Suspense fallback={<LoadingNotice fullPage />}><ForcedPasswordChange /></Suspense>;
  return (
    <FiltersProvider>
      <SyncProvider>
        <SRViewerProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Dashboard />} />
              <Route path="technicians" element={<Technicians />} />
              <Route path="technicians/:name" element={<TechnicianProfile />} />
              <Route path="srs" element={<SRs />} />
              <Route path="sync" element={<Guard allow={u => u.role === 'admin' || u.role === 'manager'}><DataSync /></Guard>} />
              <Route path="admin" element={<Guard allow={u => u.role === 'admin'}><Admin /></Guard>} />
              <Route path="account" element={<Account />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </SRViewerProvider>
      </SyncProvider>
    </FiltersProvider>
  );
}

export default function App() {
  const mobile = useIsMobile();
  const calm = useMedia('(prefers-reduced-motion: reduce)');
  const theme = useMemo(() => ({
    token: {
      colorPrimary: BRAND, colorInfo: BRAND, colorLink: BRAND, borderRadius: 9, controlHeight: mobile ? 44 : 36,
      fontFamily: FONT, colorText: '#14172e', colorTextSecondary: '#5b6080', colorTextDescription: '#646a8c', colorTextPlaceholder: '#7c819f', colorBorder: '#dcdff0',
      motion: !calm,
    },
    components: { Table: { fontSize: 13 }, Segmented: { itemSelectedBg: '#4f46e5', itemSelectedColor: '#ffffff' } },
  }), [mobile, calm]);

  return (
    <ConfigProvider theme={theme}>
      <AntApp>
        <ErrorBoundary>
          <AppConfigProvider>
            <AuthProvider>
              <BrowserRouter>
                <Routed />
              </BrowserRouter>
            </AuthProvider>
          </AppConfigProvider>
        </ErrorBoundary>
      </AntApp>
    </ConfigProvider>
  );
}
