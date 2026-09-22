import type { Prisma } from "@prisma/client";

export const DOCUMENT_REVIEW_START = "2026-09-21";
export const DOCUMENT_REVIEW_CUTOFF = new Date("2026-09-21T00:00:00+08:00");
export function requiresDocumentReview(scope: { documentReviewRequired?: boolean | null; weekStartDate?: Date | string | null }) {
  return scope.documentReviewRequired ?? (!!scope.weekStartDate && new Date(scope.weekStartDate) >= DOCUMENT_REVIEW_CUTOFF);
}
export const fixturePlanScope: Prisma.DrawingLibraryItemWhereInput = {
  deletedAt: null,
  OR: [
    { sampleTasks: { some: { deletedAt: null, status: { notIn: ['CANCELLED','COMPLETED'] }, documentReviewRequired: true } } },
    { productionPlanOrders: { some: { deletedAt: null, status: { notIn: ["cancelled", "completed"] }, batches: { some: { deletedAt: null, releaseState: { notIn: ["cancelled", "archived"] }, documentReviewRequired: true } } } } },
    { workOrders: { some: { deletedAt: null, planActive: true, status: { notIn: ["cancelled", "completed"] }, documentReviewRequired: true } } },
  ],
};
