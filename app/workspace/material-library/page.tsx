import MaterialLibraryWorkbench from '@/components/MaterialLibraryWorkbench';
import { requirePageAccess } from '@/lib/page-access';
import './material-library.css';

export const dynamic = 'force-dynamic';

export default async function MaterialLibraryPage({ searchParams }: { searchParams?: { sessionId?: string | string[] } }) {
  const user = await requirePageAccess('/workspace/material-library');
  const sessionId = Array.isArray(searchParams?.sessionId) ? searchParams?.sessionId[0] : searchParams?.sessionId;
  return <MaterialLibraryWorkbench user={user} initialSessionId={sessionId || ''} />;
}
