import { createContext, memo, useCallback, useContext, useMemo, useState } from 'react';
import { Drawer, Grid } from 'antd';
import RecordsTable from './RecordsTable';
import '../styles/analytics.css';

// Opens when a bar, slice or cell is clicked: the individual SRs behind it - the same table (search, sort, columns, download) as the SR list.
// `target` = { title, drill: { dim, key, bucket, aging, sla, overdue }, params? } or null. `params` are the page's current filters.
function DrillDrawer({ target, params, onClose, showTechnician = true }) {
  const screens = Grid.useBreakpoint();
  const merged = useMemo(() => (target ? { ...params, ...target.params, ...target.drill } : null), [params, target]);
  return (
    <Drawer
      title={target?.title} open={!!target} onClose={onClose} size={screens.lg ? 1000 : '100%'} destroyOnHidden
      styles={{ body: { paddingTop: 10 } }}
    >
      {target && (
        <>
          <p className="an-muted" style={{ margin: '0 0 10px', fontSize: 12.5 }}>
            The SRs behind this figure, with the filters and time basis of the page you came from. Click an SR for its full history.
          </p>
          <RecordsTable params={merged} title={target.title} showTechnician={showTechnician} pageSize={10} id="drill" />
        </>
      )}
    </Drawer>
  );
}

const DrillContext = createContext(() => {});
export const useDrill = () => useContext(DrillContext);

// Owns the open/closed state of the drill-down drawer so that opening it does not re-render the charts on the page: only this component
// and the drawer update, the `children` element stays the same.
export function DrillHost({ params, showTechnician = true, children, onNavigate }) {
  const [target, setTarget] = useState(null);
  const open = useCallback(t => {
    if (t?.navigate) onNavigate?.(t.navigate);
    else setTarget(t);
  }, [onNavigate]);
  return (
    <DrillContext.Provider value={open}>
      {children}
      <DrillDrawer target={target} params={params} onClose={() => setTarget(null)} showTechnician={showTechnician} />
    </DrillContext.Provider>
  );
}

export default memo(DrillDrawer);
