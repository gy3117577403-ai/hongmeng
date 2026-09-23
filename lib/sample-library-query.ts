import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { meaningfulDraft, normalizedSampleSearch, preferredHistory, record, rows, sampleSearchTokens, type LibraryDetail, type LibraryHistory, type LibrarySource, type LibraryProduct } from './sample-library';

// These predicates are shared by list, detail and protected media. Archived real
// tasks remain discoverable; test/training and soft-deleted sources never do.
export const libraryTaskWhere = { deletedAt: null, dataPurpose: 'PRODUCTION', drawingLibraryItem: { deletedAt: null } } satisfies Prisma.SampleTaskWhereInput;
const cte = Prisma.sql`WITH task_counts AS (
 SELECT t.drawing_library_item_id AS product_id, t.id, t.updated_at,
 (SELECT count(*)::int FROM sample_photos p WHERE p.task_id=t.id AND p.deleted_at IS NULL) AS photos,
 (SELECT count(*)::int FROM sample_data_entries e WHERE e.task_id=t.id AND e.deleted_at IS NULL) +
 (SELECT count(*)::int FROM sample_draft_sections s CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.payload->'rows')='array' THEN s.payload->'rows' ELSE '[]'::jsonb END) r
 WHERE s.task_id=t.id AND s.revision>s.last_submitted_revision AND EXISTS (SELECT 1 FROM jsonb_each_text(r) j WHERE j.key IN ('processName','model','seconds','recommendedSeconds','measuredMilliseconds','outerPeelMm','innerPeelMm','insertionLengthMm','remark') AND btrim(coalesce(j.value,''))<>'')) AS parameters
 FROM sample_tasks t WHERE t.deleted_at IS NULL AND t.data_purpose='PRODUCTION'
), products AS (
 SELECT d.id,d.specification,d.customer_name AS "customerName",d.product_name AS "productName",
 sum(t.photos)::int AS photos,sum(t.parameters)::int AS parameters,count(*)::int AS tasks,max(t.updated_at) AS "updatedAt",
 lower(regexp_replace(d.specification, '[[:space:]_‐‑–—-]+', '', 'g')) AS search_model,
 lower(regexp_replace(d.specification || ' ' || d.customer_name || ' ' || coalesce(d.product_name,''), '[[:space:]_‐‑–—-]+', '', 'g')) AS search_text
 FROM drawing_library_items d JOIN task_counts t ON t.product_id=d.id WHERE d.deleted_at IS NULL
 GROUP BY d.id HAVING sum(t.photos)+sum(t.parameters)>0
)`;
export async function listLibrary(search: URLSearchParams) {
  const q = (search.get('q') || '').slice(0, 120), customer = (search.get('customer') || '').slice(0, 200);
  const page = Math.max(1, Math.min(100000, Math.floor(Number(search.get('page')) || 1))), pageSize = 12;
  const predicates: Prisma.Sql[] = [Prisma.sql`true`];
  for (const token of sampleSearchTokens(q)) predicates.push(Prisma.sql`position(${token} in search_text)>0`);
  if (customer) predicates.push(Prisma.sql`"customerName"=${customer}`);
  if (search.get('filter') === 'photos') predicates.push(Prisma.sql`photos>0`);
  if (search.get('filter') === 'parameters') predicates.push(Prisma.sql`parameters>0`);
  if (search.has('ids')) {
    const ids = (search.get('ids') || '').split(',').filter(id => /^[a-zA-Z0-9_-]{1,80}$/.test(id)).slice(0, 20);
    predicates.push(ids.length ? Prisma.sql`id IN (${Prisma.join(ids)})` : Prisma.sql`false`);
  }
  const where = Prisma.sql`WHERE ${Prisma.join(predicates, ' AND ')}`;
  const [items, total, customers] = await Promise.all([
    prisma.$queryRaw<(Omit<LibraryProduct, 'updatedAt' | 'thumbnailId'> & { updatedAt: Date })[]>(Prisma.sql`${cte} SELECT * FROM products ${where} ORDER BY CASE WHEN search_model=${normalizedSampleSearch(q)} THEN 0 WHEN starts_with(search_model,${normalizedSampleSearch(q)}) THEN 1 ELSE 2 END,"updatedAt" DESC,id LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`),
    prisma.$queryRaw<{ total: number }[]>(Prisma.sql`${cte} SELECT count(*)::int AS total FROM products ${where}`),
    prisma.$queryRaw<{ name: string; count: number }[]>(Prisma.sql`${cte} SELECT "customerName" AS name,count(*)::int AS count FROM products GROUP BY "customerName" ORDER BY "customerName"`),
  ]);
  const thumbnails = items.length ? await prisma.$queryRaw<{ productId: string; id: string }[]>(Prisma.sql`SELECT DISTINCT ON (t.drawing_library_item_id) t.drawing_library_item_id AS "productId",p.id FROM sample_photos p JOIN sample_tasks t ON t.id=p.task_id WHERE t.drawing_library_item_id IN (${Prisma.join(items.map(item=>item.id))}) AND t.deleted_at IS NULL AND t.data_purpose='PRODUCTION' AND t.status<>'CANCELLED' AND p.deleted_at IS NULL AND p.review_status NOT IN ('VOIDED','CHANGES_REQUESTED') ORDER BY t.drawing_library_item_id,CASE WHEN p.review_status IN ('APPROVED','PUBLISHED') THEN 0 ELSE 1 END,p.created_at DESC,p.id`) : [];
  return { items: items.map(({ id, specification, customerName, productName, photos, parameters, tasks, updatedAt }) => ({ id, specification, customerName, productName, photos, parameters, tasks, updatedAt: updatedAt.toISOString(), thumbnailId: thumbnails.find(photo=>photo.productId===id)?.id || null })), total: total[0]?.total || 0, page, pageSize, customers };
}
export async function libraryDetail(productId: string): Promise<LibraryDetail | null> {
  const product = await prisma.drawingLibraryItem.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, specification: true, customerName: true, productName: true } });
  if (!product) return null;
  const tasks = await prisma.sampleTask.findMany({ where: { ...libraryTaskWhere, drawingLibraryItemId: productId }, select: {
    id: true, code: true, status: true, updatedAt: true, unitPlannedMilliseconds: true,
    submissions: { select: { id: true, revision: true, status: true, submittedAt: true } },
    entries: { where: { deletedAt: null }, select: { id: true, submissionRevision: true, reviewStatus: true } },
    photos: { where: { deletedAt: null }, select: { id: true, submissionRevision: true, reviewStatus: true } },
    draftSections: { select: { revision: true, lastSubmittedRevision: true, payload: true } },
  } });
  // Fetch only snapshot identities for the history selector, not every version's payload.
  const identities = await prisma.$queryRaw<{id:string;entries:unknown;photos:unknown}[]>(Prisma.sql`SELECT s.id,
    jsonb_path_query_array(coalesce(s.reviewed_snapshot,s.snapshot),'$.entries[*].id') AS entries,
    jsonb_path_query_array(coalesce(s.reviewed_snapshot,s.snapshot),'$.photos[*].id') AS photos
    FROM sample_submissions s JOIN sample_tasks t ON t.id=s.task_id WHERE t.drawing_library_item_id=${productId} AND t.deleted_at IS NULL AND t.data_purpose='PRODUCTION'`);
  const histories: LibraryHistory[] = [];
  for (const task of tasks) {
    const revisions = new Set<number | null>([...task.submissions.map(row=>row.revision), ...task.entries.map(row=>row.submissionRevision), ...task.photos.map(row=>row.submissionRevision)]);
    const drafts = task.draftSections.filter(section=>section.revision>section.lastSubmittedRevision).flatMap(section=>rows(record(section.payload).rows).filter(meaningfulDraft)).length;
    if (drafts) revisions.add(null);
    for (const revision of revisions) {
      const submission = task.submissions.find(row=>row.revision===revision);
      const frozen = identities.find(row=>row.id===submission?.id);
      const entries = task.entries.filter(row=>submission && Array.isArray(frozen?.entries) ? frozen.entries.includes(row.id) : row.submissionRevision===revision), photos = task.photos.filter(row=>submission && Array.isArray(frozen?.photos) ? frozen.photos.includes(row.id) : row.submissionRevision===revision);
      const records = [...entries, ...photos];
      const status = submission?.status || (records.length && records.every(row=>['APPROVED','PUBLISHED'].includes(row.reviewStatus)) ? 'APPROVED' : records.some(row=>row.reviewStatus==='VOIDED') ? 'VOIDED' : records.some(row=>row.reviewStatus==='CHANGES_REQUESTED') ? 'CHANGES_REQUESTED' : 'DRAFT');
      if (!records.length && !(revision===null && drafts) && !submission) continue;
      histories.push({ key: `${task.id}:${revision??'draft'}`, taskId: task.id, code: task.code, revision, status, date: (submission?.submittedAt || task.updatedAt).toISOString(), photos: photos.length, parameters: entries.length+(revision===null?drafts:0), cancelled: task.status==='CANCELLED', unitPlannedMilliseconds: task.unitPlannedMilliseconds });
    }
  }
  histories.sort((a,b)=>b.date.localeCompare(a.date)||b.key.localeCompare(a.key));
  return { product, histories, defaultKey: preferredHistory(histories) };
}
export async function librarySource(productId: string, key: string): Promise<LibrarySource | null> {
  const detail = await libraryDetail(productId), history = detail?.histories.find(row=>row.key===key);
  if (!history) return null;
  const submission = history.revision===null ? null : await prisma.sampleSubmission.findUnique({where:{taskId_revision:{taskId:history.taskId,revision:history.revision}}});
  const snapshot = record(submission?.reviewedSnapshot || submission?.snapshot);
  const entrySnapshots = rows(snapshot.entries), photoSnapshots = rows(snapshot.photos);
  const task = await prisma.sampleTask.findFirst({ where: { ...libraryTaskWhere, id: history.taskId, drawingLibraryItemId: productId }, include: {
    entries: { where: { deletedAt: null, ...(submission?{id:{in:entrySnapshots.map(row=>String(row.id))}}:{submissionRevision:history.revision}) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { parameterConflict: { select: { status: true, deletedAt: true } } } },
    photos: { where: { deletedAt: null, ...(submission?{id:{in:photoSnapshots.map(row=>String(row.id))}}:{submissionRevision:history.revision}) }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] },
    draftSections: history.revision===null,
  } });
  if (!task) return null;
  const entries = task.entries.map(entry => { const frozen = entrySnapshots.find(row=>row.id===entry.id); return { id: entry.id, kind: String(frozen?.kind||entry.kind), label: String(frozen?.label||entry.label||'')||null, payload: record(frozen?.payload||entry.payload), status: history.status, conflict: entry.parameterConflict?.status==='PENDING' && !entry.parameterConflict.deletedAt, date: entry.updatedAt.toISOString() }; });
  for (const section of task.draftSections.filter(row=>row.revision>row.lastSubmittedRevision)) rows(record(section.payload).rows).filter(meaningfulDraft).forEach((row,index)=>entries.push({ id: `draft:${section.id}:${index}`, kind: section.kind, label: null, payload: row, status: 'DRAFT', conflict: false, date: section.updatedAt.toISOString() }));
  const photos = task.photos.map(photo=>{const frozen=photoSnapshots.find(row=>row.id===photo.id);return { id: photo.id, category: String(frozen?.category||photo.category), caption: String(frozen?.caption||photo.caption||'')||null, name: String(frozen?.originalName||photo.originalName), date: photo.createdAt.toISOString(), status: history.status };});
  return { history, entries, photos, comment: submission?.decisionComment || null };
}
