import crypto from 'node:crypto';
import { EightDReportError, type EightDStoredPdfInput } from '@/lib/eight-d-reports';
import { fileType, safeFilename, validateFileContent } from '@/lib/validation';

export type PreparedEightDPdf = {
  body: Buffer;
  file: EightDStoredPdfInput;
};

function ymd(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

export async function prepareEightDPdf(
  upload: File,
  reportId: string,
  input: { displayName?: string | null; note?: string | null } = {},
): Promise<PreparedEightDPdf> {
  const body = Buffer.from(await upload.arrayBuffer());
  const validationError = validateFileContent(upload.name, upload.type, upload.size, body);
  if (validationError) throw new EightDReportError(validationError);
  if (fileType(upload.name, upload.type) !== 'pdf') {
    throw new EightDReportError('8D档案仅支持正式PDF文件');
  }
  const id = crypto.randomUUID();
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  const objectKey = `quality/8d/${reportId}/versions/${ymd(new Date())}/${id}-${safeFilename(upload.name)}`;
  return {
    body,
    file: {
      id,
      originalName: upload.name.slice(0, 240),
      displayName: input.displayName?.trim().slice(0, 240) || null,
      mimeType: 'application/pdf',
      size: body.length,
      sha256,
      objectKey,
      pageCount: null,
      note: input.note?.trim().slice(0, 500) || null,
    },
  };
}
