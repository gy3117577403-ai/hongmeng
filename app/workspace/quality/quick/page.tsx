import { requirePageAccess } from '@/lib/page-access';
import QuickQualityWorkbench from '@/components/quality-quick/QuickQualityWorkbench';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:{workOrderId?:string;productId?:string;new?:string}}) {
  const user=await requirePageAccess('/workspace/quality/quick');
  return <QuickQualityWorkbench user={user} workOrderId={searchParams.workOrderId} productId={searchParams.productId} openNew={searchParams.new==='1'}/>;
}
