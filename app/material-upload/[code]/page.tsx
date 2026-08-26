import MaterialLibraryMobileCapture from '@/components/MaterialLibraryMobileCapture';
import { requirePageAccess } from '@/lib/page-access';
import './material-upload.css';

export const dynamic = 'force-dynamic';

export default async function MaterialUploadPage({ params }: { params: { code: string } }) {
  const next = `/material-upload/${encodeURIComponent(params.code)}`;
  const user = await requirePageAccess('/material-upload', next);
  return <MaterialLibraryMobileCapture code={params.code} user={user} />;
}
