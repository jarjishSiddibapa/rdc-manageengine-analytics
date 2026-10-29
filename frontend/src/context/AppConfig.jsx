import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { publicAPI } from '../services/api';
import { setExportBrand } from '../utils/exporters';

// The names, texts and sign-in rules an administrator has set (Admin > Settings > Identity / Security). Loaded once at start, before
// anybody has signed in, from the public endpoint (nothing secret). The values below are what shows until it answers - and what shows
// if it never does - and they are the shipped defaults.
export const FALLBACK_CONFIG = {
  app_name: 'ManageEngine Analytics',
  org_name: '',
  sidebar_subtitle: 'Service desk',
  login_subtitle: 'Service desk performance',
  login_headline: 'See how every technician is really performing.',
  login_blurb: 'Turnaround, backlog and due-time performance for every SR in ManageEngine, measured from the moment it was assigned or raised.',
  login_footer: 'Syncs with ManageEngine automatically',
  support_email: '',
  lockout: { attempts: 5, minutes: 15 },
  password: { min_length: 8, max_length: 200, mixed_case: false, digit: false, symbol: false, block_common: true },
};

const AppConfigContext = createContext({ config: FALLBACK_CONFIG, refresh: () => {} });

export function AppConfigProvider({ children }) {
  const [config, setConfig] = useState(FALLBACK_CONFIG);

  const refresh = useCallback(async () => {
    try {
      const res = await publicAPI.config();
      setConfig({ ...FALLBACK_CONFIG, ...res.data });
      setExportBrand(res.data.app_name);
    } catch { /* the shipped names stay */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo(() => ({ config, refresh }), [config, refresh]);
  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}

export const useAppConfig = () => useContext(AppConfigContext);

// The antd form rules for a new password under the administrator's policy (the server checks the same).
export function passwordRules(policy = FALLBACK_CONFIG.password) {
  return [
    { min: policy.min_length, message: `At least ${policy.min_length} characters` },
    {
      validator: (_, v) => {
        if (!v) return Promise.resolve();
        if (policy.mixed_case && !(/[a-z]/.test(v) && /[A-Z]/.test(v))) return Promise.reject(new Error('Use both upper and lower case letters'));
        if (policy.digit && !/\d/.test(v)) return Promise.reject(new Error('Include at least one number'));
        if (policy.symbol && !/[^A-Za-z0-9]/.test(v)) return Promise.reject(new Error('Include at least one symbol, such as ! # or $'));
        return Promise.resolve();
      },
    },
  ];
}

// "At least 10 characters, with a number" - the password rules in words, for the hints under a password box.
export function passwordHint(policy = FALLBACK_CONFIG.password) {
  const extra = [policy.mixed_case && 'upper and lower case letters', policy.digit && 'a number', policy.symbol && 'a symbol'].filter(Boolean);
  return `At least ${policy.min_length} characters${extra.length ? `, with ${extra.join(', ')}` : ''}.`;
}
