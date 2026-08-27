import { requirePageAccess } from '@/lib/page-access';
import QualityTasksShell from '@/components/QualityTasksShell';
import '../quality/internal-risks/internal-quality-risk.css';
import '../quality/internal-risks/quality-workflow-v2.css';
export default async function QualityTasksPage() {
  return <QualityTasksShell user={await requirePageAccess('/workspace/quality-tasks')} />;
}
