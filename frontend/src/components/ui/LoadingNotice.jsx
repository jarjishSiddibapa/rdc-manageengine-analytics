import BrandMark from './BrandMark';

// A calm placeholder while a screen loads. `fullPage` is the very first load (before we know who is signed in).
export function LoadingNotice({ fullPage = false, label = 'Loading...' }) {
  if (fullPage) {
    return (
      <div className="boot" role="status" aria-live="polite">
        <BrandMark size={52} />
        <span>{label}</span>
      </div>
    );
  }
  return (
    <div className="loading-notice" role="status" aria-live="polite">
      <span className="skel-line" style={{ width: 160 }} />
      <span className="sr-only">{label}</span>
    </div>
  );
}

// Page-shaped skeleton: a row of figures and a couple of cards. Used while a screen's code (or first data) arrives.
export function PageSkeleton({ kpis = 4, cards = 2 }) {
  return (
    <div className="page-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading...</span>
      <div className="skel-line" style={{ width: 'min(100%, 560px)', height: 14, marginBottom: 14 }} />
      {kpis > 0 && (
        <div className="kpis" aria-hidden="true">
          {Array.from({ length: kpis }, (_, i) => <div key={i} className="kpi skel-card" style={{ height: 82 }} />)}
        </div>
      )}
      <div className="grid g2" aria-hidden="true">
        {Array.from({ length: cards }, (_, i) => <div key={i} className="card skel-card" style={{ height: 260 }} />)}
      </div>
    </div>
  );
}
