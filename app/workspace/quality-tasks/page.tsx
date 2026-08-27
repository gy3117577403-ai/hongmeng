import { requirePageAccess } from '@/lib/page-access';
import QualityTasksShell from '@/components/QualityTasksShell';
import '../quality/internal-risks/internal-quality-risk.css';
import '../quality/internal-risks/quality-workflow-v2.css';
import '../quality/internal-risks/quality-workflow-v3.css';
import { qualityReturnPath } from '@/lib/quality-workflow-shared';
export default async function QualityTasksPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  return <QualityTasksShell user={await requirePageAccess('/workspace/quality-tasks', qualityReturnPath('/workspace/quality-tasks', searchParams))} />;
}
