import './home-dashboard.css';
import './home-collaboration.css';

export default function CompanyHomeLoading() {
  return (
    <main className="hm-home-shell hm-workbench-root hm-collab-root hm-collab-loading" aria-busy="true" aria-label="首页加载中">
      <aside className="hm-platform-sidebar hm-collab-loading-sidebar" aria-hidden="true"><span>杭</span>{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</aside>
      <header className="hm-workbench-header is-home hm-collab-loading-header" aria-hidden="true">
        <i /><span><b /><small /></span><div /><section><em /><em /><em /></section><strong />
      </header>
      <div className="hm-home-frame hm-collab-frame" aria-hidden="true">
        <section className="hm-collab-workbench hm-collab-loading-scene">
          <header className="hm-collab-scene-heading"><div><span /><p /></div><i /></header>
          <div className="hm-collab-loading-core"><i /><span /><b /><small /></div>
          <div className="hm-collab-card-grid">
            {['plan', 'drawing', 'issue', 'production', 'material', 'labor'].map(position => (
              <article className={`hm-collab-card position-${position} hm-collab-loading-card`} key={position}>
                <i /><div><span /><b /><small /></div>
              </article>
            ))}
          </div>
        </section>
        <section className="hm-collab-insights hm-collab-loading-insights">
          {Array.from({ length: 4 }, (_, index) => <article key={index}><span /><b /><i /><i /><i /></article>)}
        </section>
      </div>
    </main>
  );
}
