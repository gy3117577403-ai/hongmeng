import { moduleAllows } from '@/lib/module-permissions';
import OrderPoolPage from '@/components/planning/OrderPoolPage';
import { redirect } from 'next/navigation';
import PlanningCenterShell from '@/components/PlanningCenterShell';
import SampleTeamCenter from '@/components/SampleTeamCenter';
import { requirePageAccess } from '@/lib/page-access';
import './planning-center.css';
import '../sample-team-workbench.css';
import '../sample-plan-schedule.css';

export default async function WeeklyPlanCenterPage({ searchParams }: { searchParams?: { branch?: string | string[]; chooseMode?: string | string[] } }) {
  const branch = Array.isArray(searchParams?.branch) ? searchParams?.branch[0] : searchParams?.branch;
  const user = await requirePageAccess(branch === 'samples' ? '/weekly-plan-center?branch=samples' : '/weekly-plan-center');
  const chooseMode = Array.isArray(searchParams?.chooseMode) ? searchParams?.chooseMode[0] : searchParams?.chooseMode;
  const modeDrawerInitiallyOpen = chooseMode === '1';
  if (branch !== 'samples' && moduleAllows(user.access, ['planning']) === false) {
    if (moduleAllows(user.access, ['order-pool']) === true) return <OrderPoolPage user={user}/>;
    if (moduleAllows(user.access, ['sample-planning']) === true) redirect('/weekly-plan-center?branch=samples');
  }
  if (branch === 'samples') return <SampleTeamCenter user={user} mode="planning" modeDrawerInitiallyOpen={modeDrawerInitiallyOpen} />;
  return <PlanningCenterShell user={user} modeDrawerInitiallyOpen={modeDrawerInitiallyOpen} />;
}
