import ProductionExecutionCenter from '@/components/ProductionExecutionCenter';
import SampleTeamCenter from '@/components/SampleTeamCenter';
import { requirePageAccess } from '@/lib/page-access';
import './production-workbench.css';
import '../sample-team-workbench.css';

export default async function ProductionPage({ searchParams }: { searchParams?: { branch?: string | string[]; chooseMode?: string | string[] } }) {
  const user = await requirePageAccess('/production');
  const branch = Array.isArray(searchParams?.branch) ? searchParams?.branch[0] : searchParams?.branch;
  const chooseMode = Array.isArray(searchParams?.chooseMode) ? searchParams?.chooseMode[0] : searchParams?.chooseMode;
  const modeDrawerInitiallyOpen = chooseMode === '1';
  if (branch === 'samples') return <SampleTeamCenter user={user} mode="execution" modeDrawerInitiallyOpen={modeDrawerInitiallyOpen} />;
  return <ProductionExecutionCenter user={user} modeDrawerInitiallyOpen={modeDrawerInitiallyOpen} />;
}
