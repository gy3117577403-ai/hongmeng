import Link from 'next/link';
import { requirePageAccess } from '@/lib/page-access';
import { WeComRobotSettingsCard } from '@/components/WeComRobotSettingsCard';

export const dynamic = 'force-dynamic';
export default async function QualityNotificationSettings() {
  const user = await requirePageAccess('/workspace/quality/internal-risks', '/workspace/quality/notifications');
  const canSend = user.laborRole === 'ADMIN' || user.access.capabilities.includes('ACCOUNT_ADMIN:MANAGE');
  return <main style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <h1 style={{ fontSize: 24 }}>质量消息提醒</h1><Link href="/workspace/quality/internal-risks">返回质量异常</Link>
    </header>
    <WeComRobotSettingsCard canSend={canSend} />
  </main>;
}
