import { redirect } from 'next/navigation';
import DashboardShell from '@/components/DashboardShell';
import { currentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serializeWorkOrder } from '@/lib/work-orders';

export default async function Dashboard() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const [orders, categories] = await Promise.all([
    prisma.workOrder.findMany({
      where: { deletedAt: null },
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
