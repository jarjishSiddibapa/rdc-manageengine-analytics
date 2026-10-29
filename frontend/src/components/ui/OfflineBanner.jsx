import { useEffect, useState } from 'react';
import { DisconnectOutlined } from '@ant-design/icons';
import { useSync } from '../../context/Sync';

// Shown across the top while the browser is offline or the server cannot be reached; figures already on screen stay as they were.
export default function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const { offline } = useSync() || {};
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  if (online && !offline) return null;
  return (
    <div className="offline-banner" role="status">
      <DisconnectOutlined />
      <span>{online ? 'Cannot reach the server right now. What you see may be out of date; it will refresh by itself when the connection returns.' : 'You are offline. What you see may be out of date; it will refresh when you are back online.'}</span>
    </div>
  );
}
