import { requirePageAccess } from '@/lib/page-access';
import QuickQualityWorkbench from '@/components/quality-quick/QuickQualityWorkbench';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:{workOrderId?:string;new?:string}}) {
  const user=await requirePageAccess('/workspace/quality/quick');
  return <QuickQualityWorkbench user={user} workOrderId={searchParams.workOrderId} openNew={searchParams.new==='1'}/>;
}
