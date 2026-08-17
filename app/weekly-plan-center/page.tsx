import PlanningCenterShell from '@/components/PlanningCenterShell';
import SampleTeamCenter from '@/components/SampleTeamCenter';
import { requirePageAccess } from '@/lib/page-access';
import './planning-center.css';
import '../sample-team-workbench.css';

export default async function WeeklyPlanCenterPage({ searchParams }: { searchParams?: { branch?: string | string[] } }) {
  const user = await requirePageAccess('/weekly-plan-center');
  const branch = Array.isArray(searchParams?.branch) ? searchParams?.branch[0] : searchParams?.branch;
  if (branch === 'samples') return <SampleTeamCenter user={user} mode="planning" />;
  return <PlanningCenterShell user={user} />;
}
