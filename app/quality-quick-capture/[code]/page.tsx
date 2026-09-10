import { requirePageAccess } from '@/lib/page-access';
import QuickQualityWorkbench from '@/components/quality-quick/QuickQualityWorkbench';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:{code:string}}) {
  const user=await requirePageAccess('/quality-quick-capture/'+encodeURIComponent(params.code));
  return <QuickQualityWorkbench user={user} mobile code={params.code} openNew/>;
}
