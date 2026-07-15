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
