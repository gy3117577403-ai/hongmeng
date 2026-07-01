import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="account-page">
      <section className="account-card">
        <div className="account-brand">▤</div>
        <p className="account-kicker">页面不存在</p>
        <h1>未找到对应资料页</h1>
        <p>请返回工单资料库继续查看生产资料。</p>
        <Link className="account-submit" href="/dashboard">返回资料库</Link>
      </section>
    </main>
  );
}
