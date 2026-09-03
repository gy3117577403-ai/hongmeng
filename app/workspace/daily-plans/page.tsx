import DailyShipmentWorkbench, { type ShipmentView } from '@/components/daily-shipments/DailyShipmentWorkbench';
import { chinaDateKey } from '@/lib/china-date';
import { loadDailyShipmentWorkbench } from '@/lib/daily-shipment-service';
import { requirePageAccess } from '@/lib/page-access';
import { productionDateKey } from '@/lib/production-week';
import './daily-shipment-workbench.css';

export const dynamic = 'force-dynamic';

export default async function DailyPlansPage({ searchParams }: { searchParams?: { date?: string; view?: string } }) {
  const user = await requirePageAccess('/workspace/daily-plans');

  let initialDate = chinaDateKey(new Date());
  try {
    if (searchParams?.date) initialDate = productionDateKey(searchParams.date);
  } catch {
    // Invalid URL dates fall back to today's Shanghai business date.
  }

  const initialView: ShipmentView = ['today', 'warning', 'carryover', 'history'].includes(searchParams?.view || '')
    ? searchParams!.view as ShipmentView
    : 'today';

  const initialData = await loadDailyShipmentWorkbench({ shipDate: initialDate, actorUserId: user.id });
  return <DailyShipmentWorkbench user={user} initialDate={initialDate} initialData={initialData} initialView={initialView} />;
}
