import { memo } from 'react';
import { Button, Popconfirm, Space } from 'antd';
import { CloudSyncOutlined, DeploymentUnitOutlined } from '@ant-design/icons';
import { useAuth } from '../context/Auth';
import { useSync } from '../context/Sync';

// "Sync SRs" fetches only what changed since the last sync; "Deep Sync SRs" re-reads every SR in ManageEngine.
// The status object changes with every poll while a sync runs (the SR counter); the buttons only care about two yes/no facts, so they
// are drawn by a memoised view and stay still between polls.
export default function SyncButtons({ size = 'middle', vertical = false }) {
  const { canSync } = useAuth();
  const { status, start } = useSync();
  if (!canSync) return null;
  return <SyncButtonsView size={size} vertical={vertical} running={!!status?.running} disabled={!status?.configured} start={start} />;
}

const SyncButtonsView = memo(function SyncButtonsView({ size, vertical, running, disabled, start }) {
  const why = disabled ? 'ManageEngine is not configured yet' : running ? 'A sync is already running' : undefined;
  return (
    <Space size={8} orientation={vertical ? 'vertical' : 'horizontal'} style={vertical ? { width: '100%' } : undefined} wrap>
      <Button type="primary" size={size} block={vertical} icon={<CloudSyncOutlined />} disabled={disabled || running} title={why || 'Fetch only the SRs that changed since the last sync'} aria-label="Sync SRs" onClick={() => start('quick')}><span className="sync-btn-text">Sync SRs</span></Button>
      <Popconfirm
        title="Run a deep sync?"
        description="Reads every SR in ManageEngine from the newest to the very first and refreshes this app's copy. It can take several minutes. Sync SRs is enough for day-to-day."
        okText="Deep sync" onConfirm={() => start('deep')} disabled={disabled || running}
      >
        <Button size={size} block={vertical} icon={<DeploymentUnitOutlined />} disabled={disabled || running} aria-label="Deep Sync SRs" title={why || 'Re-read every SR from ManageEngine'}><span className="sync-btn-text">Deep Sync SRs</span></Button>
      </Popconfirm>
    </Space>
  );
});
