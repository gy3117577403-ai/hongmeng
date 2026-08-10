import CompanyHomeDashboard from '@/components/home/CompanyHomeDashboard';
import { emptyHomeDashboardData, loadHomeDashboard } from '@/lib/home-dashboard';
import { scopeHomeDashboardData } from '@/lib/home-dashboard-access';
import { requirePageAccess } from '@/lib/page-access';
import './home-dashboard.css';
import './home-collaboration.css';

export const dynamic = 'force-dynamic';

export default async function CompanyHomePage() {
  const user = await requirePageAccess('/home');

  let data;
  try {
    data = scopeHomeDashboardData(await loadHomeDashboard(), user.access);
  } catch {
    data = emptyHomeDashboardData('首页数据暂时无法加载，请稍后重试');
  }

  return <CompanyHomeDashboard user={user} data={data} />;
}
