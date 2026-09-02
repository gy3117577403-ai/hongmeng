export default function ProductTimesLoading() {
  return <main className="product-time-page hm-product-time-workbench" aria-busy="true" aria-label="产品工时正在加载">
    <section className="product-time-toolbar"><span>正在加载产品工时工作台…</span></section>
    <section className="product-time-workspace">
      <aside className="product-time-products"><header><span><small>产品总库</small><strong>加载中</strong></span></header></aside>
      <section className="product-time-route"><div className="product-time-empty large"><strong>正在读取工序与工时</strong><span>页面骨架已就绪，数据返回后会自动显示。</span></div></section>
    </section>
  </main>;
}

