import { requirePageAccess } from '@/lib/page-access';
import QualityDataPrint from '@/components/quality-data/QualityDataPrint';
import '../../quality-data.css';
import './print.css';
export const dynamic = 'force-dynamic';
export default async function Page({params,searchParams}:{params:{id:string};searchParams:{version?:string}}){
  await requirePageAccess('/workspace/quality/data/' + params.id + '/print');
  return <QualityDataPrint id={params.id} version={searchParams.version}/>;
}
