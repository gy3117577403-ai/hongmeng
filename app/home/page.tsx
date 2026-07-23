import { redirect } from 'next/navigation';
import CompanyHomeDashboard from '@/components/home/CompanyHomeDashboard';
import { currentUser } from '@/lib/auth';
import { emptyHomeDashboardData, loadHomeDashboard } from '@/lib/home-dashboard';
import './home-dashboard.css';

export const dynamic = 'force-dynamic';

export default async function CompanyHomePage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fhome');
  if (user.laborRole === 'EMPLOYEE') redirect('/workspace/reports?view=labor');

  let data;
  try {
    data = await loadHomeDashboard();
  } catch {
    data = emptyHomeDashboardData('首页数据暂时无法加载，请稍后重试');
  }

  return <CompanyHomeDashboard user={user} data={data} />;
}
