import WarehouseManagementShell from '@/components/WarehouseManagementShell';
import SampleTeamCenter from '@/components/SampleTeamCenter';
import { requirePageAccess } from '@/lib/page-access';
import './warehouse-workbench.css';
import '../../sample-team-workbench.css';

export default async function WarehouseManagementPage({ searchParams }: { searchParams?: { branch?: string | string[]; chooseMode?: string | string[] } }) {
  const user = await requirePageAccess('/workspace/warehouse');
  const branch = Array.isArray(searchParams?.branch) ? searchParams.branch[0] : searchParams?.branch;
  const chooseMode = Array.isArray(searchParams?.chooseMode) ? searchParams.chooseMode[0] : searchParams?.chooseMode;
  const modeDrawerInitiallyOpen = chooseMode === '1';
  if (branch === 'samples') return <SampleTeamCenter user={user} mode="materials" modeDrawerInitiallyOpen={modeDrawerInitiallyOpen} />;
  return <WarehouseManagementShell user={user} modeDrawerInitiallyOpen={modeDrawerInitiallyOpen} />;
}
