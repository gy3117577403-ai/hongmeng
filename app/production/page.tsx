import ProductionExecutionCenter from '@/components/ProductionExecutionCenter';
import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/page-access';
import './production-workbench.css';
import '../sample-team-workbench.css';
import '../sample-plan-schedule.css';

export default async function ProductionPage({ searchParams }: { searchParams?: { branch?: string | string[]; chooseMode?: string | string[]; taskId?: string | string[]; sampleView?: string | string[]; sampleSearch?: string | string[] } }) {
  const user = await requirePageAccess('/production');
  const branch = Array.isArray(searchParams?.branch) ? searchParams?.branch[0] : searchParams?.branch;
  const chooseMode = Array.isArray(searchParams?.chooseMode) ? searchParams?.chooseMode[0] : searchParams?.chooseMode;
  const modeDrawerInitiallyOpen = chooseMode === '1';
  if (branch === 'samples') { const query = new URLSearchParams({ branch: 'samples' }); for (const key of ['taskId','sampleView','sampleSearch'] as const) { const value = searchParams?.[key]; if (value) query.set(key, Array.isArray(value) ? value[0] : value); } redirect(`/weekly-plan-center?${query}`); }
  return <ProductionExecutionCenter user={user} modeDrawerInitiallyOpen={modeDrawerInitiallyOpen} />;
}
