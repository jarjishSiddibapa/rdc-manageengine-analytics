import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authAPI, SESSION_ENDED } from '../services/api';

const AuthContext = createContext(null);

export const ROLE_LABELS = { admin: 'Administrator', manager: 'Manager', viewer: 'Viewer' };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // True after the server ended the session (idle too long, signed out elsewhere, account disabled): the sign-in page says so.
  // The address is left alone, so signing in again lands on the same page.
  const [expired, setExpired] = useState(false);
  const [bootError, setBootError] = useState(null);
  const userRef = useRef(null);
  userRef.current = user;

  const boot = useCallback(() => {
    setBootError(null);
    setLoading(true);
    authAPI.me()
      .then(res => setUser(res.data.user))
      .catch(error => { if (error.network || error.response?.status >= 500) setBootError(error.message); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    boot();
    const ended = () => { if (userRef.current) { setExpired(true); setUser(null); } };
    window.addEventListener(SESSION_ENDED, ended);
    return () => window.removeEventListener(SESSION_ENDED, ended);
  }, [boot]);

  // Coming back to the tab after a long time: find out now, not on the next click, that the session is gone.
  useEffect(() => {
    let last = Date.now();
    const check = () => {
      if (document.visibilityState !== 'visible' || !userRef.current || Date.now() - last < 60000) return;
      last = Date.now();
      authAPI.me().catch(() => {});
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await authAPI.login(email, password);
    setExpired(false);
    setUser(res.data.user);
    return res.data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await authAPI.logout(); } catch { /* the cookie is cleared by the server; either way this browser is signed out */ }
    setExpired(false);
    setUser(null);
  }, []);

  const value = useMemo(() => ({
    user, loading, expired, bootError, retryBoot: boot, login, logout, setUser,
    isAdmin: user?.role === 'admin',
    canSync: user?.role === 'admin' || user?.role === 'manager',
  }), [user, loading, expired, bootError, boot, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
