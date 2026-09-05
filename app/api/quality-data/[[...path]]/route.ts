import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { qualitySession, qualityError, qualityBody } from '@/lib/quality-data-http';
import { createQualityRecord, listQualityRecords, loadQualityRecord, mutateQualityRecord, qualityExportRecords, qualityOrderOptions, qualityQrOrder, qualityHistory, qualityHistoricalRecord, positivePage } from '@/lib/quality-data-service';
import { uploadQualityFile, deleteQualityFile, qualityFileContent } from '@/lib/quality-data-files';
import { qualityWorkbook, qualityZip } from '@/lib/quality-data-export';
import { QualityDataError } from '@/lib/quality-data';
import { qualityOptions } from '@/lib/quality-data-options';
import { createReference, mutateReference, loadReference, listReferences, favoriteReference, referenceHistory, referenceVersion, exportReferences } from '@/lib/quality-reference-service';
import { uploadReferenceFile, deleteReferenceFile, referenceFileContent } from '@/lib/quality-reference-files';
import { referenceWorkbook, referenceZip } from '@/lib/quality-reference-export';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
type Context = { params: { path?: string[] } };
export async function GET(req: NextRequest, { params }: Context) {
  try {
    const { actor } = await qualitySession();
    const p = params.path || [], query = req.nextUrl.searchParams;
    let data: unknown;
    if (p.length === 1 && p[0] === 'options') data = await qualityOptions(query.get('q'));
    else if (p.length === 1 && p[0] === 'references') data = await listReferences(query,actor.id);
    else if (p.length === 1 && p[0] === 'reference-export') {
      const records=await exportReferences(query,actor.id);
      if(query.get('format')==='zip')return new Response(Readable.toWeb(await referenceZip(records)) as ReadableStream,{headers:{...privateHeaders,'Content-Type':'application/zip','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('端子参考档案.zip')}});
      return new Response(new Uint8Array(await referenceWorkbook(records)),{headers:{...privateHeaders,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('端子参考数据.xlsx')}});
    }
    else if (p.length === 2 && p[0] === 'references') data = await loadReference(p[1],actor.id);
    else if (p.length === 3 && p[0] === 'references' && p[2] === 'revisions') data = await referenceHistory(p[1],positivePage(query.get('page')));
    else if (p.length === 4 && p[0] === 'references' && p[2] === 'revisions') data = await referenceVersion(p[1],positivePage(p[3]));
    else if (p.length === 1 && p[0] === 'orders') data = await qualityOrderOptions(query);
    else if (p.length === 2 && p[0] === 'qr') data = await qualityQrOrder(p[1]);
    else if (p.length === 1 && p[0] === 'records') data = await listQualityRecords(query);
    else if (p.length === 2 && p[0] === 'records') data = await loadQualityRecord(p[1]);
    else if (p.length === 3 && p[0] === 'records' && p[2] === 'revisions') data = await qualityHistory(p[1], positivePage(query.get('page')));
    else if (p.length === 4 && p[0] === 'records' && p[2] === 'revisions') data = await qualityHistoricalRecord(p[1], positivePage(p[3]));
    else if (p.length === 3 && ['attachments','reference-files'].includes(p[0]) && p[2] === 'content') {
      const { file, stream } = p[0] === 'attachments' ? await qualityFileContent(p[1], query.get('historyVersion')) : await referenceFileContent(p[1],query.get('historyVersion'));
      const inline = query.get('download') !== '1' && (file.mimeType.startsWith('image/') || file.mimeType === 'application/pdf');
      return new Response(Readable.toWeb(stream) as ReadableStream, { headers: {
        ...privateHeaders, 'Content-Type': file.mimeType, 'Content-Length': String(file.size),
        'Content-Disposition': (inline ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(file.originalName),
      } });
    } else if (p.length === 1 && p[0] === 'export') {
      const records = await qualityExportRecords(query), filter = query.toString();
      if (query.get('format') === 'zip') {
        const stream = await qualityZip(records, filter);
        return new Response(Readable.toWeb(stream) as ReadableStream, { headers: { ...privateHeaders, 'Content-Type': 'application/zip', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent('质量批次档案.zip') } });
      }
      const bytes = await qualityWorkbook(records, filter);
      return new Response(new Uint8Array(bytes), { headers: { ...privateHeaders, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent('质量数据.xlsx') } });
    } else throw new QualityDataError('接口不存在', 404);
    return NextResponse.json({ ok: true, data }, { headers: privateHeaders });
  } catch (error) { return qualityError(error); }
}
export async function POST(req: NextRequest, { params }: Context) {
  try {
    assertSameOriginMutationRequest(req);
    const { actor } = await qualitySession('CREATE'), p = params.path || [];
    let data: unknown;
    if (p.length === 1 && p[0] === 'references') data = await createReference(actor,await qualityBody(req));
    else if(p.length===3 && p[0]==='references' && p[2]==='attachments') {
      if(Number(req.headers.get('content-length')||0)>21*1024*1024)throw new QualityDataError('附件内容过大',413);
      data=await uploadReferenceFile(p[1],actor,await req.formData());
    }
    else if (p.length === 1 && p[0] === 'records') data = await createQualityRecord(actor, await qualityBody(req));
    else if (p.length === 3 && p[0] === 'records' && p[2] === 'attachments') {
      if (Number(req.headers.get('content-length') || 0) > 21 * 1024 * 1024) throw new QualityDataError('附件内容过大', 413);
      data = await uploadQualityFile(p[1], actor, await req.formData());
    } else throw new QualityDataError('接口不存在', 404);
    return NextResponse.json({ ok: true, data }, { headers: privateHeaders });
  } catch (error) { return qualityError(error); }
}
export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    assertSameOriginMutationRequest(req);
    const { actor } = await qualitySession('UPDATE'), p = params.path || [];
    if (p.length !== 2 || !['records','references'].includes(p[0])) throw new QualityDataError('接口不存在', 404);
    const body=await qualityBody(req);
    const data=p[0]==='records'?await mutateQualityRecord(p[1],actor,body):body.action==='FAVORITE'?await favoriteReference(p[1],actor.id,body.favorite):await mutateReference(p[1],actor,body);
    return NextResponse.json({ ok: true, data }, { headers: privateHeaders });
  } catch (error) { return qualityError(error); }
}
export async function DELETE(req: NextRequest, { params }: Context) {
  try {
    assertSameOriginMutationRequest(req);
    const { actor } = await qualitySession('DELETE'), p = params.path || [], body = await qualityBody(req);
    if (p.length !== 2 || !['records','attachments','references','reference-files'].includes(p[0])) throw new QualityDataError('接口不存在', 404);
    const data = p[0] === 'records' ? await mutateQualityRecord(p[1], actor, { ...body, action: 'DELETE' }) : p[0]==='attachments'?await deleteQualityFile(p[1], actor, body):p[0]==='references'?await mutateReference(p[1],actor,{...body,action:'DELETE'}):await deleteReferenceFile(p[1],actor,body);
    return NextResponse.json({ ok: true, data }, { headers: privateHeaders });
  } catch (error) { return qualityError(error); }
}
