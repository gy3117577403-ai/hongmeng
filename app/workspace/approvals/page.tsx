import MajorQualityApprovalShell from '@/components/MajorQualityApprovalShell';
import { requirePageAccess } from '@/lib/page-access';
import './major-approvals.css';

export default async function MajorQualityApprovalsPage() {
  const user = await requirePageAccess('/workspace/approvals');
  return <MajorQualityApprovalShell user={user} />;
}
