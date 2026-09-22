import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import SampleTaskPrintSheet from '@/components/SampleTaskPrintSheet';
import SampleTaskPrintToolbar from '@/components/SampleTaskPrintToolbar';
import { prisma } from '@/lib/prisma';
import { requirePageAccess } from '@/lib/page-access';
import { sampleTaskInclude, serializeSampleTask } from '@/lib/sample-team';
import { assertSampleDrawingApproved } from '@/lib/sample-plan-operations';
import { SamplePlanError } from '@/lib/sample-plan-domain';
import { FixtureError } from '@/lib/quality-fixture-domain';
import {
  buildSamplePrintDocument,
  parseSamplePrintMode,
  samplePrintBackHref,
  samplePrintBaseUrl,
  samplePrintQrDataUrl,
  samplePrintRequestOrigin,
} from '@/lib/sample-task-print';
import '../sample-print.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SampleTaskPrintPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { mode?: string | string[]; from?: string | string[] };
}) {
  noStore();
  const modeValue = Array.isArray(searchParams?.mode) ? searchParams?.mode[0] : searchParams?.mode;
  const fromValue = Array.isArray(searchParams?.from) ? searchParams?.from[0] : searchParams?.from;
  const mode = parseSamplePrintMode(modeValue);
  const from = fromValue === 'execution' || fromValue === 'materials' ? fromValue : 'planning';
  const query = new URLSearchParams({ mode, from });
  const next = `/sample-print/${encodeURIComponent(params.id)}?${query.toString()}`;
  const user = await requirePageAccess('/sample-capture', next);
  const taskRecord = await prisma.sampleTask.findFirst({
    where: { id: params.id, deletedAt: null },
    include: sampleTaskInclude,
  });
  if (!taskRecord) notFound();
  let approvedId: string | null = null;
  try { approvedId = await prisma.$transaction(tx => assertSampleDrawingApproved(tx, taskRecord, false)); }
  catch (e) {
    if (!(e instanceof SamplePlanError) && !(e instanceof FixtureError)) throw e;
    return <main className="sample-print-screen"><h1>图纸资料待审核</h1><p>{e.message}</p><a href={`/weekly-plan-center?branch=samples&taskId=${taskRecord.id}`}>返回样品计划处理资料</a></main>;
  }

  const task = serializeSampleTask(taskRecord);
  if (task.taskType === 'REPEAT') {
    const pack = approvedId ? await prisma.qfPackage.findUnique({ where: { id: approvedId } }) : null;
    return <main className="sample-print-screen">
      <SampleTaskPrintToolbar repeat backHref={samplePrintBackHref(from)} currentHref={next} blankHref={next} mode="current" taskCode={task.code} pageCount={1} />
      <article style={{ background: 'white', padding: '18mm', maxWidth: '210mm', minHeight: '270mm', margin: '20px auto', color: '#172b43' }}>
        <h1 style={{ borderBottom: '2px solid #ef6a17', paddingBottom: 20 }}>老产品样品制作单</h1>
        <h2>{task.specification}</h2><p>{task.customerName} · {task.productName}</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', lineHeight: 3 }}><tbody>
          {[['任务编号', task.code], ['计划周', task.planWeekStartDate || '待排期'], ['计划数量', task.sampleQuantity], ['计划出货', task.dueDate || '未设置'], ['图纸版本', pack ? `${pack.revision} · 第 ${pack.sequence} 次` : '历史资料'], ['主管审核', pack?.supervisorName || '历史任务'], ['品质审核', pack?.qualityName || '历史任务'], ['计划备注', task.planRemark || '—']].map(([label, value]) => <tr key={String(label)} style={{ borderBottom: '1px solid #dbe2e8' }}><th style={{ width: '30%', textAlign: 'left' }}>{label}</th><td>{value}</td></tr>)}
        </tbody></table><p style={{ marginTop: 40 }}>完成后登记实际数量，转入成品仓待入库，备注“样品完成”。</p>
      </article>
    </main>;
  }
  const requestOrigin = samplePrintRequestOrigin(headers());
  const baseUrl = samplePrintBaseUrl(process.env.APP_BASE_URL, requestOrigin);
  const document = buildSamplePrintDocument(task, {
    mode,
    baseUrl,
    printedBy: user.displayName || user.username,
  });
  const qrDataUrl = await samplePrintQrDataUrl(document.captureUrl);
  const printPath = `/sample-print/${encodeURIComponent(params.id)}`;
  const currentHref = `${printPath}?${new URLSearchParams({ mode: 'current', from }).toString()}`;
  const blankHref = `${printPath}?${new URLSearchParams({ mode: 'blank', from }).toString()}`;

  return <main className="sample-print-screen">
    <SampleTaskPrintToolbar
      backHref={samplePrintBackHref(from)}
      currentHref={currentHref}
      blankHref={blankHref}
      mode={mode}
      taskCode={task.code}
      pageCount={document.pages.length}
    />
    <aside className="sample-print-browser-notice" data-print-hidden>
      <strong>{mode === 'blank' ? '当前是空白标准模板' : '当前只打印服务器已保存内容'}</strong>
      <span>浏览器或手机里尚未同步的草稿不会进入打印单；A4 纵向、缩放 100%，超过默认行数会自动生成续页。</span>
    </aside>
    <SampleTaskPrintSheet document={document} qrDataUrl={qrDataUrl} />
  </main>;
}
