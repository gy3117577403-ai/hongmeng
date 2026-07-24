import { redirect } from 'next/navigation';
import DashboardShell from '@/components/DashboardShell';
import { currentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serializeWorkOrder } from '@/lib/work-orders';
import './dashboard-workbench.css';

type DashboardPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function Dashboard({ searchParams = {} }: DashboardPageProps) {
  const user = await currentUser();
  if (!user) {
    const params = new URLSearchParams();
    Object.entries(searchParams).forEach(([key, value]) => {
      if (typeof value === 'string') params.set(key, value);
      else value?.forEach(item => params.append(key, item));
    });
    const next = `/dashboard${params.size ? `?${params.toString()}` : ''}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const hasParam = (name: string): boolean => {
    const value = searchParams[name];
    return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.length > 0;
  };
  const keepsLegacyUtility = [
    'openSettings',
    'openLogs',
    'openTrash',
    'openWeeklyImport',
    'openOrders',
    'changePassword',
    'categoryId',
    'categoryCode',
    'fileId',
    'workOrder',
    'workOrderCode',
    'returnKey',
  ].some(hasParam);

  if (!keepsLegacyUtility) {
    const productionParams = new URLSearchParams();
    const workOrderId = searchParams.workOrderId;
    const targetId = Array.isArray(workOrderId) ? workOrderId[0] : workOrderId;
    if (targetId) productionParams.set('workOrderId', targetId);
    redirect(`/production${productionParams.size ? `?${productionParams.toString()}` : ''}`);
  }

  const [orders, categories] = await Promise.all([
    prisma.workOrder.findMany({
      where: { deletedAt: null, planActive: true },
      include: { resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } } },
      orderBy: [{ createdAt: 'desc' }, { code: 'asc' }],
    }),
    prisma.resourceCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);

  return (
    <DashboardShell
      user={user}
      initialWorkOrders={orders.map(serializeWorkOrder)}
      categories={categories.map(c => ({ id: c.id, name: c.name, code: c.code, sortOrder: c.sortOrder }))}
    />
  );
}
