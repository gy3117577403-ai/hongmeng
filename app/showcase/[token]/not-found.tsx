import Link from 'next/link';
import styles from './share-not-found.module.css';

export default function CapabilityShowcaseNotFound() {
  return (
    <main className={styles.page}>
      <section>
        <span>404</span>
        <h1>分享链接不可用</h1>
        <p>链接可能已停用、过期，或尚未发布有效内容。请联系分享方重新获取。</p>
        <Link href="/login">返回登录页</Link>
      </section>
    </main>
  );
}
