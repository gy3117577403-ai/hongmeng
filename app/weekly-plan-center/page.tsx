import PlanningCenterShell from '@/components/PlanningCenterShell';
import SampleTeamCenter from '@/components/SampleTeamCenter';
import { requirePageAccess } from '@/lib/page-access';
import './planning-center.css';
import '../sample-team-workbench.css';

export default async function WeeklyPlanCenterPage({ searchParams }: { searchParams?: { branch?: string | string[]; chooseMode?: string | string[] } }) {
  const user = await requirePageAccess('/weekly-plan-center');
  const branch = Array.isArray(searchParams?.branch) ? searchParams?.branch[0] : searchParams?.branch;
  const chooseMode = Array.isArray(searchParams?.chooseMode) ? searchParams?.chooseMode[0] : searchParams?.chooseMode;
  const modeDrawerInitiallyOpen = chooseMode === '1';
  if (branch === 'samples') return <SampleTeamCenter user={user} mode="planning" modeDrawerInitiallyOpen={modeDrawerInitiallyOpen} />;
  return <PlanningCenterShell user={user} modeDrawerInitiallyOpen={modeDrawerInitiallyOpen} />;
}
