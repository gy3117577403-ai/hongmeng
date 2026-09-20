'use client';
export { default } from './QualityPaperArchiveWorkbench';
import type { QualityOrder, QualityInspectionStep } from '@/lib/quality-data';
export type FirstOverview = { order: QualityOrder; steps: Array<QualityInspectionStep & { result: string | null; count: number; retired?: boolean }>; unassignedCount: number };
