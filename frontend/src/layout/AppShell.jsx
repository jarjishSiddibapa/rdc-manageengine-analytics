import { Suspense, memo, useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { Dropdown, Segmented, Tooltip } from 'antd';
import {
  AppstoreOutlined, CloudSyncOutlined, MenuOutlined, SafetyCertificateOutlined, TableOutlined, TeamOutlined, UserOutlined, LogoutOutlined, CloseOutlined,
} from '@ant-design/icons';
import { ROLE_LABELS, useAuth } from '../context/Auth';
import { useAppConfig } from '../context/AppConfig';
import { BASES, useFilters } from '../context/Filters';
import { useSync } from '../context/Sync';
import { useIsMobile } from '../hooks/useMedia';
import SyncButtons from '../components/SyncButtons';
import AggSwitch from '../components/AggSwitch';
import BrandMark from '../components/ui/BrandMark';
import OfflineBanner from '../components/ui/OfflineBanner';
import { ErrorBoundary } from '../components/ui/ErrorState';
import { PageSkeleton } from '../components/ui/LoadingNotice';

const TITLES = [
  ['/technicians/', 'Technician'], ['/technicians', 'Technicians'], ['/srs', 'All SRs'], ['/sync', 'Data & sync'], ['/admin', 'Admin'], ['/account', 'My account'], ['/', 'Team dashboard'],
];
const titleFor = (path, fallback) => TITLES.find(([p]) => (p === '/' ? path === '/' : path.startsWith(p)))?.[1] || fallback;
const ANALYTIC_PAGES = ['/', '/technicians', '/srs'];
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea';

// "ManageEngine Analytics" -> two lines in the narrow sidebar: the first word, then the rest.
function brandLines(name) {
  const [first, ...rest] = String(name).trim().split(/\s+/);
  return rest.length ? <>{first}<br />{rest.join(' ')}</> : first;
}

// The counter changes every couple of seconds while a sync runs. It is drawn in tabular digits inside a box that keeps its width
// and never wraps, so the controls next to it do not shift, and the spinner is a plain CSS ring rather than a re-rendered widget.
function SyncStatus({ compact = false }) {
  const { status } = useSync();
  const running = status?.running;
  if (running) {
    return (
      <Tooltip title={running.message}>
        <span className="sync-status running" role="status">
          <i className="sync-spin" aria-hidden="true" />
          {running.mode === 'deep' ? 'Deep sync' : 'Sync'}: {running.fetched.toLocaleString()} SRs
        </span>
      </Tooltip>
    );
  }
  if (status?.lastSuccess) {
    const when = dayjs(status.lastSuccess.finished_at);
    return (
      <Tooltip title={`${status.stored.total.toLocaleString()} SRs stored. ${status.auto.minutes ? `Syncs automatically every ${status.auto.minutes} minutes.` : 'Automatic sync is off.'}${status.deep?.enabled ? ` A deep sync runs daily at ${status.deep.time}.` : ''}`}>
        <span className="sync-status">Synced {when.format(compact ? 'DD MMM, hh:mm A' : 'DD MMM, hh:mm A')}</span>
      </Tooltip>
    );
  }
  return status ? <span className="sync-status warn">Not synced yet</span> : null;
}

function MobileSyncStatus() {
  const { status } = useSync();
  return status?.running ? <SyncStatus /> : null;
}

// Only re-drawn when the chosen basis changes, not each time the sync poll brings a new counter.
const BasisSwitch = memo(function BasisSwitch({ basis, setBasis }) {
  return (
    <Tooltip title="Where the clock starts. 'Since assigned' measures how long the technician took (default). 'Since raised' measures how long the requester waited.">
      <Segmented value={basis} onChange={setBasis} options={BASES.map(b => ({ value: b.value, label: b.label }))} aria-label="Measure time from" />
    </Tooltip>
  );
});

export default function AppShell() {
  const { user, logout, isAdmin, canSync } = useAuth();
  const { config } = useAppConfig();
  const { basis, setBasis } = useFilters();
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const sidebarRef = useRef(null);
  const menuBtnRef = useRef(null);
  const titleRef = useRef(null);
  const mainRef = useRef(null);
  const firstPath = useRef(location.pathname);

  const closeMenu = useCallback((restoreFocus = false) => { setOpen(false); if (restoreFocus) menuBtnRef.current?.focus(); }, []);
  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => { if (!mobile) setOpen(false); }, [mobile]);
  useEffect(() => { document.title = `${titleFor(location.pathname, config.app_name)} · ${config.app_name}`; }, [location.pathname, config.app_name]);

  // A new page starts at the top, and screen-reader and keyboard users land on its heading.
  useEffect(() => {
    if (firstPath.current === location.pathname) return;
    firstPath.current = location.pathname;
    window.scrollTo(0, 0);
    titleRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  // The phone menu behaves like a dialog: focus moves in, Tab stays inside, Escape closes.
  useEffect(() => {
    if (!open) return undefined;
    const side = sidebarRef.current;
    side?.querySelector('a, button')?.focus();
    const onKey = e => {
      if (e.key === 'Escape') { closeMenu(true); return; }
      if (e.key !== 'Tab' || !side) return;
      const items = [...side.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const [first, last] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, closeMenu]);

  const showAgg = location.pathname === '/' || location.pathname.startsWith('/technicians');
  const showBasis = ANALYTIC_PAGES.some(p => (p === '/' ? location.pathname === '/' : location.pathname.startsWith(p)));
  const initials = user.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const link = ({ isActive }) => `nav-link${isActive ? ' active' : ''}`;
  const signOut = () => { navigate('/', { replace: true }); logout(); };
  const hidden = mobile && !open;

  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); mainRef.current?.focus(); }}>Skip to content</a>
      <aside className={`sidebar${open ? ' open' : ''}`} ref={sidebarRef} inert={hidden} aria-label="Main" id="sidebar">
        <div className="sidebar-top">
          <NavLink to="/" className="brand" aria-label={`${config.app_name} - Team dashboard`}>
            <BrandMark />
            <div className="brand-name">{brandLines(config.app_name)}<small>{config.sidebar_subtitle}</small></div>
          </NavLink>
          {mobile && <button type="button" className="icon-btn on-dark" onClick={() => closeMenu(true)} aria-label="Close menu"><CloseOutlined /></button>}
        </div>
        <nav aria-label="Pages" className="nav">
          <div className="nav-label">Analytics</div>
          <NavLink to="/" end className={link}><AppstoreOutlined />Team dashboard</NavLink>
          <NavLink to="/technicians" className={link}><TeamOutlined />Technicians</NavLink>
          <NavLink to="/srs" className={link}><TableOutlined />All SRs</NavLink>
          {(canSync || isAdmin) && <div className="nav-label">Manage</div>}
          {canSync && <NavLink to="/sync" className={link}><CloudSyncOutlined />Data &amp; sync</NavLink>}
          {isAdmin && <NavLink to="/admin" className={link}><SafetyCertificateOutlined />Admin</NavLink>}
        </nav>
        {mobile && (
          <div className="sidebar-sync">
            <div className="nav-label" style={{ padding: '0 0 6px' }}>Data</div>
            <SyncStatus compact />
            {canSync && <div style={{ marginTop: 10 }}><SyncButtons size="large" vertical /></div>}
          </div>
        )}
        <div className="sidebar-foot">
          <Dropdown placement="topLeft" trigger={['click']} menu={{
            items: [
              { key: 'account', icon: <UserOutlined />, label: <NavLink to="/account">My account</NavLink> },
              { key: 'out', icon: <LogoutOutlined />, label: 'Sign out', danger: true },
            ],
            onClick: ({ key }) => { if (key === 'out') signOut(); },
          }}>
            <button type="button" className="user-chip" aria-label={`${user.name}, ${ROLE_LABELS[user.role]}. Account menu`} aria-haspopup="menu">
              <div className="avatar" aria-hidden="true">{initials}</div>
              <div className="who"><b>{user.name}</b><span>{ROLE_LABELS[user.role]}</span></div>
            </button>
          </Dropdown>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => closeMenu(true)} aria-hidden="true" />}

      <div className="main">
        <div className="top-stack">
          <OfflineBanner />
          <header className="topbar">
            <button type="button" ref={menuBtnRef} className="menu-btn icon-btn" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} aria-controls="sidebar"><MenuOutlined /></button>
            <h1 ref={titleRef} tabIndex={-1}>{titleFor(location.pathname, config.app_name)}</h1>
            <span className="spacer" />
            {mobile ? <MobileSyncStatus /> : (
              <div className="topbar-tools">
                {showBasis && <BasisSwitch basis={basis} setBasis={setBasis} />}
                {showAgg && <AggSwitch />}
                <SyncStatus />
                <SyncButtons size="middle" />
              </div>
            )}
          </header>
        </div>
        <main className="content" id="main" tabIndex={-1} ref={mainRef}>
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<PageSkeleton />}><div className="page-fade" key={location.pathname}><Outlet /></div></Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {mobile && (
        <nav className="bottom-nav" aria-label="Quick links">
          <NavLink to="/" end className={link}><AppstoreOutlined /><span>Dashboard</span></NavLink>
          <NavLink to="/technicians" className={link}><TeamOutlined /><span>Technicians</span></NavLink>
          <NavLink to="/srs" className={link}><TableOutlined /><span>SRs</span></NavLink>
          {canSync && <NavLink to="/sync" className={link}><CloudSyncOutlined /><span>Data</span></NavLink>}
          <button type="button" className={`nav-link${open ? ' active' : ''}`} onClick={() => setOpen(true)} aria-label="More: menu, account and sync"><MenuOutlined /><span>More</span></button>
        </nav>
      )}
    </div>
  );
}
