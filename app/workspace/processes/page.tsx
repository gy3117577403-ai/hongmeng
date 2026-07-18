import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export default async function RetiredProcessManagementPage({
  searchParams,
}: {
  searchParams: { workOrderId?: string };
}) {
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Fprocesses');
  const workOrderId = String(searchParams.workOrderId || '').trim();
  if (workOrderId) {
    const workOrder = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { drawingLibraryItemId: true },
    });
    if (workOrder?.drawingLibraryItemId) {
      redirect(`/workspace/product-times?itemId=${encodeURIComponent(workOrder.drawingLibraryItemId)}`);
    }
  }
  redirect('/workspace/product-times');
}
