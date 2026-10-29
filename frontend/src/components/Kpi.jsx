import { memo } from 'react';
import { Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { useFilters } from '../context/Filters';
import '../styles/analytics.css';

// A headline figure.
//  hint       what the number is and how it is worked out (shown in the (i) tooltip, reachable by keyboard and touch)
//  timeBased  true for turnaround figures: the tooltip adds which clock (assigned or raised) is in use right now
//  delta      { text, tone: 'good' | 'bad' | 'flat' } - a comparison, usually with the team
//  spark      a short array of numbers drawn as a small trend line (nulls leave a gap)
//  loading    shows a placeholder instead of a misleading 0
function Spark({ values, color }) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v !== null && v !== undefined && !Number.isNaN(v));
  if (pts.length < 2) return null;
  const W = 72;
  const H = 26;
  const min = Math.min(...pts.map(p => p[1]));
  const max = Math.max(...pts.map(p => p[1]));
  const x = i => 2 + (i / Math.max(1, values.length - 1)) * (W - 4);
  const y = v => (max === min ? H / 2 : H - 3 - ((v - min) / (max - min)) * (H - 6));
  const path = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const [li, lv] = pts[pts.length - 1];
  return (
    <svg className="an-kpi-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Trend over the last ${values.length} months`}>
      <path d={path} fill="none" stroke={color || '#4f46e5'} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(li)} cy={y(lv)} r="2.6" fill={color || '#4f46e5'} stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

export const Kpi = memo(function Kpi({ label, value, sub, hint, tone, delta, accent, loading, spark, timeBased }) {
  const { basis } = useFilters();
  const tip = (hint || timeBased) && (
    <div className="an-kpi-tip">
      <b>{label}</b>
      {hint && <div>{hint}</div>}
      {timeBased && <div className="basis">Clock: {basis === 'raised' ? 'since the SR was raised' : 'since the SR was assigned to the technician'} (change it at the top of the page).</div>}
    </div>
  );
  return (
    <div className={`kpi${tone === 'bad' ? ' bad' : ''}`} style={accent ? { '--kpi-accent': accent } : undefined}>
      <div className="kpi-label an-kpi-label">
        <span>{label}</span>
        {tip && (
          <Tooltip title={tip} trigger={['hover', 'focus', 'click']}>
            <button type="button" className="an-info-btn" aria-label={`What "${label}" means`}><InfoCircleOutlined /></button>
          </Tooltip>
        )}
      </div>
      {loading ? (
        <>
          <div className="an-kpi-skel" />
          <div className="an-kpi-skel sm" />
        </>
      ) : (
        <>
          <div className="an-kpi-row">
            <div className="kpi-value">{value}</div>
            {spark && <Spark values={spark} color={accent} />}
          </div>
          {delta && <div className={`kpi-delta delta-${delta.tone || 'flat'}`}>{delta.tone === 'good' ? '✓ ' : delta.tone === 'bad' ? '⚠ ' : ''}{delta.text}</div>}
          {sub && <div className="kpi-sub">{sub}</div>}
        </>
      )}
    </div>
  );
});

export const KpiGrid = ({ children }) => <div className="kpis">{children}</div>;
