import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import SampleTaskPrintSheet from '@/components/SampleTaskPrintSheet';
import SampleTaskPrintToolbar from '@/components/SampleTaskPrintToolbar';
import { prisma } from '@/lib/prisma';
import { requirePageAccess } from '@/lib/page-access';
import { sampleTaskInclude, serializeSampleTask } from '@/lib/sample-team';
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

  const task = serializeSampleTask(taskRecord);
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
