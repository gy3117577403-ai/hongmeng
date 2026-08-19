import AccessDataAuditShell from '@/components/AccessDataAuditShell';
import { requirePageAccess } from '@/lib/page-access';
import './permissions-workbench.css';

export const dynamic = 'force-dynamic';

export default async function AccessDataAuditPage() {
  const user = await requirePageAccess('/workspace/permissions');
  return <AccessDataAuditShell user={user} />;
}
