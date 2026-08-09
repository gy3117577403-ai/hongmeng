import './production-workbench.css';

export default function ProductionLoading() {
  return (
    <main className="production-page hm-production-workbench hm-workbench-root hm-production-route-loading" aria-busy="true" aria-label="生产调度中心加载中">
      <aside className="hm-production-loading-sidebar" aria-hidden="true"><strong>杭</strong>{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</aside>
      <div className="production-execution-main" aria-hidden="true">
        <section className="production-dispatch-command hm-production-loading-command">
          <div><i /><span><b /><small /></span></div>
          <nav>{Array.from({ length: 5 }, (_, index) => <i key={index} />)}</nav>
          <aside><i /><i /></aside>
        </section>
        <section className="hm-production-loading-summary">
          {Array.from({ length: 6 }, (_, index) => <article key={index}><i /><span /><b /></article>)}
        </section>
        <section className="hm-production-loading-toolbar"><i /><i /><i /><span /></section>
        <div className="production-dispatch-layout rail-open hm-production-loading-layout">
          <section className="production-dispatch-list-panel">
            <header className="production-dispatch-list-head"><span>产品信息</span><span>工序进度</span><span>生产日期</span><span>安排人员</span><span>工时完成进度</span><span>交期 / 风险</span><span>现场操作</span></header>
            <div className="production-dispatch-list">
              {Array.from({ length: 9 }, (_, index) => <div className="production-dispatch-row production-dispatch-row-skeleton" key={index}>{Array.from({ length: 7 }, (_, cell) => <span key={cell} />)}</div>)}
            </div>
          </section>
          <aside className="production-dispatch-rail open hm-production-loading-rail">{Array.from({ length: 4 }, (_, index) => <article key={index}><i /><b /><span /><span /></article>)}</aside>
        </div>
      </div>
    </main>
  );
}
