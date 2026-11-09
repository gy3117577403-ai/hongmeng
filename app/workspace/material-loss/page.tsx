import { requirePageAccess } from '@/lib/page-access';
import MaterialLossWorkbench from '@/components/material/MaterialLossWorkbench';
export default async function MaterialLossPage() {
  const user = await requirePageAccess('/workspace/material-loss');
  return <MaterialLossWorkbench user={user}/>;
}
