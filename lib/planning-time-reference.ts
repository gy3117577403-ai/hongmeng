import { Prisma } from '@prisma/client';
import { resolvePlanMilliseconds } from './planning-time';

type Reference = {
  drawingLibraryItemId: string; planOrderId: string; batchId: string | null; batchNo: number | null;
  quantity: number; unitMilliseconds: number; weekStartDate: string | null; weekEndDate: string | null;
  updatedAt: string; planTimeSource: string;
};

export async function loadPlanningTimeReferences(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  itemIds: string[],
  options: { batchId?: string; batchIds?: string[]; scoped?: boolean } = {},
): Promise<Map<string, Reference>> {
  if (!itemIds.length) return new Map();
  const scope = options.scoped
    ? Prisma.sql`AND (b.id = ${options.batchId || ''} OR b.id IN (${Prisma.join(options.batchIds?.length ? options.batchIds : [''])}))`
    : Prisma.empty;
  // Pick the same batch for value, dates and quantity. An explicitly opened
  // batch wins; otherwise latest production week wins, never last edit time.
  const rows = await tx.$queryRaw<Array<Reference & { batchUnit: number | null; orderUnit: number | null }>>(Prisma.sql`
    SELECT DISTINCT ON (o.drawing_library_item_id)
      o.drawing_library_item_id AS "drawingLibraryItemId", o.id AS "planOrderId",
      b.id AS "batchId", b.batch_no AS "batchNo", b.quantity,
      b.unit_milliseconds_snapshot AS "batchUnit", o.planning_unit_milliseconds AS "orderUnit",
      to_char(b.week_start_date + interval '8 hours', 'YYYY-MM-DD') AS "weekStartDate",
      to_char(b.week_end_date + interval '8 hours', 'YYYY-MM-DD') AS "weekEndDate",
      b.updated_at::text AS "updatedAt", b.plan_time_source AS "planTimeSource"
    FROM production_plan_batches b JOIN production_plan_orders o ON o.id = b.plan_order_id
    WHERE b.deleted_at IS NULL AND o.deleted_at IS NULL
      AND o.drawing_library_item_id IN (${Prisma.join(itemIds)}) ${scope}
    ORDER BY o.drawing_library_item_id, (b.id = ${options.batchId || ''}) DESC,
      b.week_start_date DESC, b.created_at DESC, b.id DESC
  `);
  const references = new Map<string, Reference>();
  for (const row of rows) {
    const unit = resolvePlanMilliseconds(row.batchUnit, row.orderUnit);
    if (unit) references.set(row.drawingLibraryItemId, { ...row, unitMilliseconds: unit });
  }
  // Only genuinely unallocated orders may supply a candidate without a batch.
  // A missing time on a real batch must not silently select another order.
  const absent = itemIds.filter(id => !rows.some(row => row.drawingLibraryItemId === id));
  if (!options.scoped && absent.length) {
    const orders = await tx.$queryRaw<Array<Reference>>(Prisma.sql`
      SELECT DISTINCT ON (o.drawing_library_item_id)
        o.drawing_library_item_id AS "drawingLibraryItemId", o.id AS "planOrderId",
        NULL::text AS "batchId", NULL::int AS "batchNo", 0::int AS quantity,
        o.planning_unit_milliseconds AS "unitMilliseconds", NULL::text AS "weekStartDate",
        NULL::text AS "weekEndDate", o.updated_at::text AS "updatedAt", 'order'::text AS "planTimeSource"
      FROM production_plan_orders o
      WHERE o.deleted_at IS NULL AND o.planning_unit_milliseconds > 0
        AND o.drawing_library_item_id IN (${Prisma.join(absent)})
        AND NOT EXISTS (SELECT 1 FROM production_plan_batches b WHERE b.plan_order_id = o.id)
      ORDER BY o.drawing_library_item_id, o.created_at DESC, o.id DESC
    `);
    for (const row of orders) references.set(row.drawingLibraryItemId, row);
  }
  return references;
}
