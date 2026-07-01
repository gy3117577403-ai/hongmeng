'use client';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="account-page">
      <section className="account-card">
        <div className="account-brand">▤</div>
        <p className="account-kicker">系统提示</p>
        <h1>页面加载异常</h1>
        <p>当前页面遇到临时错误，请重试或返回资料库。</p>
        <button className="account-submit" type="button" onClick={() => reset()}>重新加载</button>
      </section>
    </main>
  );
}
