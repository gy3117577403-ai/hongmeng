import { redirect } from 'next/navigation';
import DailyShipmentWorkbench from '@/components/daily-shipments/DailyShipmentWorkbench';
import { currentUser } from '@/lib/auth';
import { chinaDateKey } from '@/lib/china-date';
import { loadDailyShipmentWorkbench } from '@/lib/daily-shipment-service';
import { productionDateKey } from '@/lib/production-week';
import './daily-shipment-workbench.css';

export const dynamic = 'force-dynamic';

export default async function DailyPlansPage({ searchParams }: { searchParams?: { date?: string } }) {
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Fdaily-plans');

  let initialDate = chinaDateKey(new Date());
  try {
    if (searchParams?.date) initialDate = productionDateKey(searchParams.date);
  } catch {
    // Invalid URL dates fall back to today's Shanghai business date.
  }

  const initialData = await loadDailyShipmentWorkbench({ shipDate: initialDate });
  return <DailyShipmentWorkbench user={user} initialDate={initialDate} initialData={initialData} />;
}
