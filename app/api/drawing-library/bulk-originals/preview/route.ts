import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { extractOriginalDrawingSpecWithExisting, parseOriginalDrawingFile } from '@/lib/bulk-original-drawing-parser';
import { drawingLibraryKey } from '@/lib/drawing-library';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PreviewStatus =
  | 'ready'
  | 'duplicate'
  | 'customer-unconfirmed'
  | 'missing-spec'
  | 'suspected-non-original'
  | 'unsupported'
  | 'need-create-item';

type PreviewAction = 'upload' | 'create-item-and-upload' | 'skip' | 'need-create-item';

type PreviewRow = {
  rowId: string;
  relativePath: string;
  fileName: string;
  size: number;
  mimeType: string;
  customerFolder: string;
  customerName: string;
  specification: string;
  productName: string;
  existingItemId: string;
  duplicateFileId: string;
  status: PreviewStatus;
  action: PreviewAction;
  reason: string;
  warnings: string[];
};

type PreviewSummary = {
  scannedFiles: number;
  supportedFiles: number;
  readyFiles: number;
  uploadFiles: number;
  createItemAndUploadFiles: number;
  unmatchedFiles: number;
  duplicateFiles: number;
  suspectedNonOriginalFiles: number;
  ignoredFiles: number;
  willCreateItems: number;
  category: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max = 260) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function cleanNumber(value: unknown) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function duplicateKey(libraryItemId: string, categoryId: string, fileName: string, size: number) {
  return `${libraryItemId}::${categoryId}::${fileName}::${size}`;
}

function buildSummary(rows: PreviewRow[]): PreviewSummary {
  return {
    scannedFiles: rows.length,
    supportedFiles: rows.filter(row => row.status !== 'unsupported').length,
    readyFiles: rows.filter(row => row.status === 'ready').length,
    uploadFiles: rows.filter(row => row.action === 'upload').length,
    createItemAndUploadFiles: rows.filter(row => row.action === 'create-item-and-upload').length,
    unmatchedFiles: rows.filter(row => ['customer-unconfirmed', 'missing-spec', 'need-create-item', 'unsupported', 'suspected-non-original'].includes(row.status)).length,
    duplicateFiles: rows.filter(row => row.status === 'duplicate').length,
    suspectedNonOriginalFiles: rows.filter(row => row.status === 'suspected-non-original').length,
    ignoredFiles: rows.filter(row => row.reason === '临时或空文件').length,
    willCreateItems: rows.filter(row => row.action === 'create-item-and-upload').length,
    category: '原图',
  };
}

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const inputFiles = Array.isArray(body?.files) ? body.files.slice(0, 3000) : [];
    const aliasRows = Array.isArray(body?.customerAliases) ? body.customerAliases : [];
    const createMissing = body?.createMissing !== false;
    const allowSuspectedNonOriginal = body?.allowSuspectedNonOriginal === true;

    const aliases = new Map<string, string>();
    for (const rawAlias of aliasRows) {
      if (!isRecord(rawAlias)) continue;
      const folderName = cleanText(rawAlias.folderName, 120);
      const customerName = cleanText(rawAlias.customerName, 180);
      if (folderName && customerName) aliases.set(folderName, customerName);
    }

    const [items, files, categories] = await Promise.all([
      prisma.drawingLibraryItem.findMany({
        where: { deletedAt: null },
        select: { id: true, customerName: true, specification: true, productName: true, libraryKey: true },
      }),
      prisma.drawingLibraryFile.findMany({
        where: { deletedAt: null },
        select: { id: true, libraryItemId: true, categoryId: true, originalName: true, size: true },
      }),
      prisma.resourceCategory.findMany({
        select: { id: true, name: true, code: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    const drawingCategory = categories.find(category => category.code === 'drawing' || category.name === '原图') || null;
    if (!drawingCategory) return NextResponse.json({ ok: false, error: '图纸资料库缺少“原图”分类' }, { status: 500 });

    const itemByKey = new Map(items.map(item => [drawingLibraryKey(item.customerName === '未设置' ? '' : item.customerName, item.specification), item]));
    const customerNames = Array.from(new Set(items.map(item => item.customerName).filter(Boolean)));
    const specifications = Array.from(new Set(items.map(item => item.specification).filter(Boolean))).sort((a, b) => b.length - a.length);
    const plannedDuplicateKeys = new Set<string>();

    const rows: PreviewRow[] = inputFiles.map((rawFile, index) => {
      const fileRecord = isRecord(rawFile) ? rawFile : {};
      const fileName = cleanText(fileRecord.fileName, 260);
      const relativePath = cleanText(fileRecord.relativePath, 520);
      const customerFolder = cleanText(fileRecord.customerFolder, 120);
      const size = cleanNumber(fileRecord.size);
      const mimeType = cleanText(fileRecord.mimeType, 120);
      const parsed = parseOriginalDrawingFile({ relativePath, fileName, folderName: customerFolder, size });
      const extracted = extractOriginalDrawingSpecWithExisting(parsed.fileName || fileName, specifications);
      const folderName = parsed.customerFolder || customerFolder;
      const warnings = [...parsed.warnings];
      const aliasCustomer = aliases.get(folderName) || '';
      const exactCustomer = customerNames.filter(name => name === folderName);
      const customerName = aliasCustomer || (exactCustomer.length === 1 ? exactCustomer[0] : '');
      const rowBase = {
        rowId: `${index}-${relativePath || fileName}`,
        relativePath: parsed.relativePath || relativePath,
        fileName: parsed.fileName || fileName,
        size,
        mimeType,
        customerFolder: folderName,
        customerName,
        specification: extracted.specification,
        productName: extracted.productName,
        existingItemId: '',
        duplicateFileId: '',
        warnings,
      };

      if (!parsed.supported || parsed.ignored) {
        return {
          ...rowBase,
          status: 'unsupported' as const,
          action: 'skip' as const,
          reason: parsed.reason || '不支持的文件类型',
        };
      }

      if (parsed.suspectedNonOriginal && !allowSuspectedNonOriginal) {
        return {
          ...rowBase,
          status: 'suspected-non-original' as const,
          action: 'skip' as const,
          reason: '疑似非原图',
        };
      }

      if (!customerName) {
        return {
          ...rowBase,
          status: 'customer-unconfirmed' as const,
          action: 'skip' as const,
          reason: '客户未确认',
        };
      }

      if (!extracted.specification) {
        return {
          ...rowBase,
          status: 'missing-spec' as const,
          action: 'skip' as const,
          reason: extracted.invalidReason || parsed.invalidSpecificationReason || '规格无法识别',
        };
      }

      const key = drawingLibraryKey(customerName === '未设置' ? '' : customerName, extracted.specification);
      const existingItem = itemByKey.get(key) || null;
      if (!existingItem) {
        return {
          ...rowBase,
          status: createMissing ? 'ready' as const : 'need-create-item' as const,
          action: createMissing ? 'create-item-and-upload' as const : 'need-create-item' as const,
          reason: createMissing ? '' : '图纸资料记录不存在',
        };
      }

      const duplicate = files.find(file => (
        file.libraryItemId === existingItem.id
        && file.categoryId === drawingCategory.id
        && file.originalName === rowBase.fileName
        && Number(file.size) === Number(size)
      ));
      const plannedKey = duplicateKey(existingItem.id, drawingCategory.id, rowBase.fileName, size);
      if (duplicate || plannedDuplicateKeys.has(plannedKey)) {
        return {
          ...rowBase,
          existingItemId: existingItem.id,
          duplicateFileId: duplicate?.id || '',
          status: 'duplicate' as const,
          action: 'skip' as const,
          reason: '原图分类下已有同名且同大小文件',
        };
      }

      plannedDuplicateKeys.add(plannedKey);
      return {
        ...rowBase,
        existingItemId: existingItem.id,
        status: 'ready' as const,
        action: 'upload' as const,
        reason: '',
      };
    });

    return NextResponse.json({ ok: true, data: { summary: buildSummary(rows), rows } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '批量导入原图预览失败' }, { status: 500 });
  }
}
