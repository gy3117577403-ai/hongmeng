import { CapabilityShowcaseWorkbench } from '@/components/capability-showcase/CapabilityShowcaseWorkbench';
import { requirePageAccess } from '@/lib/page-access';
import './capability-showcase-workbench.css';

export default async function CapabilityShowcaseWorkbenchPage() {
  const user = await requirePageAccess('/workspace/capability-showcase');
  return <CapabilityShowcaseWorkbench user={user} />;
}
