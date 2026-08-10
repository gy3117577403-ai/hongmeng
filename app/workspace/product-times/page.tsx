import ProductTimeShell from '@/components/ProductTimeShell';
import { requirePageAccess } from '@/lib/page-access';
import './product-time-workbench.css';

export default async function ProductTimesPage() {
  const user = await requirePageAccess('/workspace/product-times');
  return <ProductTimeShell user={user} />;
}
