import { requirePageAccess } from '@/lib/page-access';
import QualityTasksShell from '@/components/QualityTasksShell';
import { qualityReturnPath } from '@/lib/quality-workflow-shared';
import '../quality/internal-risks/internal-quality-risk.css';
import '../quality/internal-risks/quality-workflow-v2.css';
import '../quality/internal-risks/quality-workflow-v3.css';
export default async function QualityConfirmationPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  return <QualityTasksShell reviewMode user={await requirePageAccess('/workspace/quality-confirmation', qualityReturnPath('/workspace/quality-confirmation', searchParams))} />;
}
