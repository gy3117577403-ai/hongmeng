'use client';

export default function ProductTimesError({ reset }: { reset: () => void }) {
  return <main className="product-time-page hm-product-time-workbench">
    <section className="product-time-route">
      <div className="product-time-empty large" role="alert">
        <strong>产品工时页面暂时无法打开</strong>
        <span>这不是“没有产品”，请重试；持续失败时请把页面上的追踪号提供给管理员。</span>
        <button className="hm-workbench-button primary" type="button" onClick={reset}>重新加载</button>
      </div>
    </section>
  </main>;
}

