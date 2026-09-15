import { requirePageAccess } from '@/lib/page-access';
import { loadFinishedGoods } from '@/lib/finished-goods-service';
import FinishedGoodsWorkbench from '@/components/finished-goods/FinishedGoodsWorkbench';
import './finished-goods.css';
export const dynamic = 'force-dynamic';
export default async function FinishedGoodsPage({ searchParams }: { searchParams?: { q?: string } }) {
  const user = await requirePageAccess('/workspace/finished-goods');
  const data = await loadFinishedGoods({ q: searchParams?.q, filter: 'processing' });
  return <FinishedGoodsWorkbench user={user} initialData={data} initialQuery={searchParams?.q || ''} />;
}
