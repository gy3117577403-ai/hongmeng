import ProductionExecutionCenter from '@/components/ProductionExecutionCenter';
import { requirePageAccess } from '@/lib/page-access';
import './production-workbench.css';

export default async function ProductionPage() {
  const user = await requirePageAccess('/production');
  return <ProductionExecutionCenter user={user} />;
}
