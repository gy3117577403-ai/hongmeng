import { prisma } from './prisma';

/** Short links carry no login credential and never grant access to another recipient's records. */
export async function qualityNotificationBatchReportIds(code: string | null, userId: string) {
  if (!code || !/^[A-Za-z0-9_-]{12}$/.test(code)) return [];
  const root = await prisma.qualityRiskNotification.findUnique({ where: { shortCode: code } });
  if (!root || root.recipientId !== userId || !root.deliveryGroup) return [];
  const rows = await prisma.qualityRiskNotification.findMany({ where: { deliveryGroup: root.deliveryGroup, recipientId: userId }, select: { reportId: true } });
  return [...new Set(rows.map(item => item.reportId))];
}
