import EightDArchiveShell from '@/components/EightDArchiveShell';
import { requirePageAccess } from '@/lib/page-access';
import './eight-d-archive.css';

export default async function EightDArchivePage() {
  const user = await requirePageAccess('/workspace/quality/8d');
  return <EightDArchiveShell user={user} />;
}
