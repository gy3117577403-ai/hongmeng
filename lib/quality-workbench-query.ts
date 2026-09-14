import type { Prisma } from '@prisma/client';
import { QUALITY_HANDLING } from './quality-workbench';
const handling = { status: { in: QUALITY_HANDLING } };
const pending = { status: { in: ['TODO', 'IN_PROGRESS'] } };
const active = { status: { not: 'CANCELLED' } };
export function qualityPhaseWhere(phase: string): Prisma.InternalQualityRiskReportWhereInput {
  if (phase === 'SUMMARIZING') return { ...handling, workflowVersion: { lt: 4 }, tasks: { some: active, none: pending } };
  if (phase === 'SUBMITTED') return { ...handling, tasks: { some: active, every: { status: { in: ['TODO', 'CANCELLED'] } } } };
  if (phase === 'COLLABORATING') return { ...handling, NOT: { OR: [qualityPhaseWhere('SUMMARIZING'), qualityPhaseWhere('SUBMITTED')] } };
  return { status: phase };
}
export function qualityWorkViewWhere(view: string, userId: string): Prisma.InternalQualityRiskReportWhereInput {
  if (view === 'CREATED') return { createdById: userId };
  if (view === 'LEADING') return { tasks: { some: { ownerUserId: userId, status: { not: 'CANCELLED' } } } };
  if (view === 'REVIEW') return { reviewerUserId: userId, status: 'VERIFYING' };
  if (view === 'MINE') return { OR: [{ createdById: userId, status: 'DRAFT' }, { reviewerUserId: userId, status: 'VERIFYING' }, { ...handling, tasks: { some: { ...pending, ownerUserId: userId } } }, { AND: [qualityPhaseWhere('SUMMARIZING'), { ownerUserId: userId }] }] };
  return {};
}
