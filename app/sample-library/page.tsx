import { requireMobileSession } from '@/lib/page-access';
import { canReadSampleLibrary } from '@/lib/sample-library-access';
import MobileSampleAccessNotice from '@/components/sample-library/MobileSampleAccessNotice';
import SampleLibraryMobile from '@/components/sample-library/SampleLibraryMobile';
import './sample-library.css';
export const dynamic = 'force-dynamic';
export const metadata = { title: '手机样品库 · 杭连', description: '搜索型号，查看历次样品照片与参数' };
export default async function SampleLibraryPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const params = new URLSearchParams(); for (const [key, value] of Object.entries(searchParams)) if (typeof value === 'string') params.set(key, value);
  const next = `/sample-library${params.size ? '?'+params : ''}`;
  const user = await requireMobileSession(next);
  if (!canReadSampleLibrary(user.access)) return <MobileSampleAccessNotice displayName={user.displayName} username={user.username} next={next} />;
  return <SampleLibraryMobile userId={user.id} displayName={user.displayName} />;
}
