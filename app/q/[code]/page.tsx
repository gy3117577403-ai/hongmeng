import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requirePageAccess } from '@/lib/page-access';
import { qualityTaskPath } from '@/lib/quality-workflow-shared';

export const dynamic = 'force-dynamic';
export default async function QualityNotificationLink({ params }: { params: { code: string } }) {
  if (!/^[A-Za-z0-9_-]{12}$/.test(params.code)) notFound();
  const user = await requirePageAccess('/workspace/quality-tasks', '/q/' + params.code);
  const notification = await prisma.qualityRiskNotification.findUnique({ where: { shortCode: params.code } });
  if (!notification || notification.recipientId !== user.id) redirect('/workspace/quality-tasks');
  const review = ['REVIEW', 'APPROVED'].includes(notification.eventType);
  const path = review ? '/workspace/quality-confirmation' : '/workspace/quality-tasks';
  if (notification.deliveryCount > 1) redirect(path + '?batch=' + params.code);
  redirect(qualityTaskPath(notification.reportId, notification.taskId, review));
}
