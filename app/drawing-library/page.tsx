import { redirect } from 'next/navigation';
import { DrawingLibraryShell } from '@/components/DrawingLibraryShell';
import { currentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isVisibleDrawingLibraryItem, serializeDrawingLibraryItem } from '@/lib/drawing-library';
import './drawing-library-workbench.css';

const includeFiles = {
  files: {
    where: { deletedAt: null },
    include: {
      category: { select: { id: true, name: true, code: true, sortOrder: true } },
      uploadedBy: { select: { displayName: true, username: true } },
    },
    orderBy: [{ createdAt: 'desc' as const }],
  },
  productionPlanOrders: {
    where: { deletedAt: null },
    select: { id: true },
    take: 1,
  },
};

type DrawingLibraryPageProps = {
  searchParams?: { itemId?: string | string[] };
};

export default async function DrawingLibraryPage({ searchParams }: DrawingLibraryPageProps) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const requestedItemId = Array.isArray(searchParams?.itemId) ? searchParams?.itemId[0] : searchParams?.itemId;

  const [items, requestedItem, categories] = await Promise.all([
    prisma.drawingLibraryItem.findMany({
      where: { deletedAt: null },
      include: includeFiles,
      orderBy: [{ customerName: 'asc' }, { specification: 'asc' }],
      take: 600,
    }),
    requestedItemId
      ? prisma.drawingLibraryItem.findFirst({
          where: { id: requestedItemId, deletedAt: null },
          include: includeFiles,
        })
      : Promise.resolve(null),
    prisma.resourceCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);
  const mergedItems = requestedItem && !items.some(item => item.id === requestedItem.id)
    ? [requestedItem, ...items]
    : items;
  const serialized = mergedItems
    .filter(item => item.id === requestedItemId || isVisibleDrawingLibraryItem(item))
    .map(item => serializeDrawingLibraryItem(item, categories));
  const customerMap = new Map<string, { customerName: string; customerCode: string | null; itemCount: number; missingCount: number }>();
  for (const item of serialized) {
    const current = customerMap.get(item.customerName) || { customerName: item.customerName, customerCode: item.customerCode || null, itemCount: 0, missingCount: 0 };
    current.itemCount += 1;
    if (!item.isComplete) current.missingCount += 1;
    if (!current.customerCode && item.customerCode) current.customerCode = item.customerCode;
    customerMap.set(item.customerName, current);
  }

  return (
    <DrawingLibraryShell
      user={user}
      initialItems={serialized}
      initialCustomers={[
        { customerName: '全部客户', customerCode: null, itemCount: serialized.length, missingCount: serialized.filter(item => !item.isComplete).length },
        ...Array.from(customerMap.values()),
      ]}
      categories={categories.map(category => ({ id: category.id, name: category.name, code: category.code, sortOrder: category.sortOrder }))}
    />
  );
}
