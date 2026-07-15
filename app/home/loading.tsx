import './home-dashboard.css';

export default function CompanyHomeLoading() {
  return (
    <main className="hm-home-shell hm-home-loading" aria-busy="true" aria-label="首页加载中">
      <aside className="hm-home-sidebar" aria-hidden="true">
        <div className="hm-home-loading-brand" />
        {Array.from({ length: 7 }, (_, index) => <div className="hm-home-loading-nav" key={index} />)}
      </aside>
      <div className="hm-home-frame">
        <div className="hm-home-loading-toolbar" />
        <div className="hm-home-content">
          <div className="hm-home-loading-welcome" />
          <div className="hm-home-kpis">
            {Array.from({ length: 6 }, (_, index) => <div className="hm-home-loading-kpi" key={index} />)}
          </div>
          <div className="hm-home-loading-panels">
            <div /><div /><div />
          </div>
        </div>
      </div>
    </main>
  );
}
