import ProductionExecutionCenter from '@/components/ProductionExecutionCenter';
import SampleTeamCenter from '@/components/SampleTeamCenter';
import { requirePageAccess } from '@/lib/page-access';
import './production-workbench.css';
import '../sample-team-workbench.css';

export default async function ProductionPage({ searchParams }: { searchParams?: { branch?: string | string[] } }) {
  const user = await requirePageAccess('/production');
  const branch = Array.isArray(searchParams?.branch) ? searchParams?.branch[0] : searchParams?.branch;
  if (branch === 'samples') return <SampleTeamCenter user={user} mode="execution" />;
  return <ProductionExecutionCenter user={user} />;
}
