import crypto from 'node:crypto';
import {
  MaterialLibraryCaptureStatus,
  MaterialLibraryUploadLinkStatus,
  MaterialLibraryUploadMode,
  MaterialLibraryWarningState,
  Prisma,
} from '@prisma/client';
import type {
  MaterialLibraryCaptureSessionDTO,
  MaterialLibraryCategoryDTO,
  MaterialLibraryItemDTO,
  MaterialLibraryPhotoDTO,
  MaterialLibraryUploadLinkDTO,
  MaterialLibraryUploadModeDTO,
  MaterialLibraryWarningStateDTO,
} from '@/lib/material-library-contract';

export class MaterialLibraryError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'MATERIAL_LIBRARY_INVALID',
  ) {
    super(message);
  }
}

export type MaterialLibraryActor = { id: string; name: string };

export function materialLibraryItemLockKey(materialItemId: string): string {
  return `material-library-item:${materialItemId}`;
}

export function materialLibraryActor(user: {
  id: string;
  displayName?: string | null;
  username?: string | null;
  employee?: { name?: string | null } | null;
}): MaterialLibraryActor {
  return {
    id: user.id,
    name: cleanMaterialText(user.employee?.name, 80)
      || cleanMaterialText(user.displayName, 80)
      || cleanMaterialText(user.username, 80)
      || '当前用户',
  };
}

export function cleanMaterialText(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

export function requiredMaterialText(value: unknown, label: string, max = 200): string {
  const text = cleanMaterialText(value, max);
  if (!text) throw new MaterialLibraryError(`${label}不能为空`, 400, 'MATERIAL_LIBRARY_REQUIRED');
  return text;
}

export function normalizeMaterialCode(value: unknown): string {
  const code = requiredMaterialText(value, '物料编码', 80).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._/-]{1,79}$/.test(code)) {
    throw new MaterialLibraryError('物料编码仅支持字母、数字、点、横线、斜线和下划线', 400, 'MATERIAL_CODE_INVALID');
  }
  return code;
}

export function materialWarningState(value: unknown): MaterialLibraryWarningStateDTO {
  if (value === 'ATTENTION' || value === 'DEFECT') return value;
  return 'NONE';
}

export function materialUploadMode(value: unknown): MaterialLibraryUploadModeDTO {
  if (value === 'PERMANENT') return 'PERMANENT';
  return 'TEMPORARY';
}

export function positiveVersion(value: unknown, label = '数据版本'): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new MaterialLibraryError(`${label}无效，请刷新后重试`, 409, 'MATERIAL_VERSION_INVALID');
  }
  return version;
}

function qrSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error('SESSION_SECRET missing or too short');
  return secret;
}

export function createMaterialUploadCode(input: {
  id: string;
  generation: number;
  materialItemId: string;
  mode: MaterialLibraryUploadModeDTO | MaterialLibraryUploadMode;
}): string {
  const payload = `${input.id}:${input.generation}:${input.materialItemId}:${input.mode}`;
  const signature = crypto.createHmac('sha256', qrSecret()).update(payload).digest('base64url');
  return `${input.id}.${input.generation}.${signature}`;
}

export function hashMaterialUploadCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export function parseMaterialUploadCode(value: unknown): { id: string; generation: number; signature: string } {
  const code = requiredMaterialText(value, '二维码', 240);
  const parts = code.split('.');
  if (
    parts.length !== 3
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parts[0])
    || !/^\d{1,9}$/.test(parts[1])
    || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])
  ) {
    throw new MaterialLibraryError('物料上传二维码无效或内容不完整', 404, 'MATERIAL_UPLOAD_LINK_NOT_FOUND');
  }
  return { id: parts[0], generation: Number(parts[1]), signature: parts[2] };
}

export function verifyMaterialUploadCode(input: {
  code: string;
  id: string;
  generation: number;
  materialItemId: string;
  mode: MaterialLibraryUploadModeDTO | MaterialLibraryUploadMode;
  tokenHash: string;
}): boolean {
  const parsed = parseMaterialUploadCode(input.code);
  if (parsed.id !== input.id || parsed.generation !== input.generation) return false;
  const expected = createMaterialUploadCode(input);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(input.code);
  return expectedBuffer.length === actualBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    && hashMaterialUploadCode(input.code) === input.tokenHash;
}

export function materialUploadCapturePath(input: {
  id: string;
  generation: number;
  materialItemId: string;
  mode: MaterialLibraryUploadModeDTO | MaterialLibraryUploadMode;
}): string {
  return `/material-upload/${encodeURIComponent(createMaterialUploadCode(input))}`;
}

export function assertMaterialUploadLinkActive(link: {
  status: MaterialLibraryUploadLinkStatus | string;
  mode: MaterialLibraryUploadMode | string;
  expiresAt: Date | null;
}, now = new Date()): void {
  if (link.status !== 'ACTIVE') {
    throw new MaterialLibraryError('物料上传二维码已撤销', 410, 'MATERIAL_UPLOAD_LINK_REVOKED');
  }
  if (link.mode === 'TEMPORARY' && (!link.expiresAt || link.expiresAt.getTime() <= now.getTime())) {
    throw new MaterialLibraryError('临时二维码已过期，请在电脑端重新生成', 410, 'MATERIAL_UPLOAD_LINK_EXPIRED');
  }
}

export function materialSessionNo(now = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const date = formatter.format(now).replaceAll('-', '');
  return `REC-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export const materialLibraryItemInclude = {
  category: { select: { id: true, code: true, name: true } },
  photos: {
    where: { deletedAt: null },
    orderBy: [{ isCover: 'desc' as const }, { sortOrder: 'asc' as const }, { createdAt: 'desc' as const }],
  },
} satisfies Prisma.MaterialLibraryItemInclude;

export const materialLibrarySessionInclude = {
  uploadLink: {
    select: { id: true, mode: true, status: true, expiresAt: true },
  },
  materialItem: { include: materialLibraryItemInclude },
  category: { select: { id: true, code: true, name: true } },
  photos: {
    where: { deletedAt: null },
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
  },
} satisfies Prisma.MaterialLibraryCaptureSessionInclude;

export type MaterialLibraryItemRecord = Prisma.MaterialLibraryItemGetPayload<{
  include: typeof materialLibraryItemInclude;
}>;

export type MaterialLibrarySessionRecord = Prisma.MaterialLibraryCaptureSessionGetPayload<{
  include: typeof materialLibrarySessionInclude;
}>;

type MaterialPhotoRecord = MaterialLibraryItemRecord['photos'][number];

export function serializeMaterialPhoto(photo: MaterialPhotoRecord): MaterialLibraryPhotoDTO {
  return {
    id: photo.id,
    sessionId: photo.sessionId,
    materialItemId: photo.materialItemId,
    originalName: photo.originalName,
    mimeType: photo.mimeType,
    size: Number(photo.size),
    width: photo.width,
    height: photo.height,
    rotation: photo.rotation,
    sortOrder: photo.sortOrder,
    isCover: photo.isCover,
    caption: photo.caption,
    captureSource: photo.captureSource,
    uploadedBy: photo.uploadedByName,
    deletedAt: photo.deletedAt?.toISOString() || null,
    createdAt: photo.createdAt.toISOString(),
    updatedAt: photo.updatedAt.toISOString(),
    contentUrl: `/api/material-library/photos/${photo.id}/content?v=${photo.updatedAt.getTime()}`,
  };
}

export function serializeMaterialItem(item: MaterialLibraryItemRecord): MaterialLibraryItemDTO {
  const photos = item.photos.map(serializeMaterialPhoto);
  return {
    id: item.id,
    categoryId: item.categoryId,
    category: item.category,
    code: item.code,
    name: item.name,
    manufacturerModel: item.manufacturerModel,
    specification: item.specification,
    materialComposition: item.materialComposition,
    supplierName: item.supplierName,
    supplierPartNumber: item.supplierPartNumber,
    batchNumber: item.batchNumber,
    warningState: item.warningState,
    warningNote: item.warningNote,
    status: item.status,
    notes: item.notes,
    version: item.version,
    lastCapturedAt: item.lastCapturedAt?.toISOString() || null,
    deletedAt: item.deletedAt?.toISOString() || null,
    deletedReason: item.deletedReason,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    photos,
    photoCount: photos.length,
    coverPhoto: photos.find(photo => photo.isCover) || photos[0] || null,
    dataComplete: photos.length > 0,
  };
}

export function serializeMaterialSession(session: MaterialLibrarySessionRecord): MaterialLibraryCaptureSessionDTO {
  return {
    id: session.id,
    sessionNo: session.sessionNo,
    uploadLinkId: session.uploadLinkId,
    uploadMode: session.uploadLink.mode,
    uploadLinkStatus: session.uploadLink.status,
    uploadLinkExpiresAt: session.uploadLink.expiresAt?.toISOString() || null,
    materialItemId: session.materialItemId,
    categoryId: session.categoryId,
    status: session.status,
    draftManufacturerModel: session.draftManufacturerModel,
    draftSpecification: session.draftSpecification,
    draftMaterialComposition: session.draftMaterialComposition,
    draftSupplierName: session.draftSupplierName,
    draftSupplierPartNumber: session.draftSupplierPartNumber,
    draftBatchNumber: session.draftBatchNumber,
    draftWarningState: session.draftWarningState,
    draftWarningNote: session.draftWarningNote,
    draftNotes: session.draftNotes,
    version: session.version,
    connectedById: session.connectedById,
    connectedByName: session.connectedByName,
    connectedAt: session.connectedAt?.toISOString() || null,
    lastSeenAt: session.lastSeenAt?.toISOString() || null,
    completedAt: session.completedAt?.toISOString() || null,
    cancelledAt: session.cancelledAt?.toISOString() || null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    item: serializeMaterialItem(session.materialItem),
    photos: session.photos.map(serializeMaterialPhoto),
  };
}

export function serializeMaterialCategory(category: {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isSystem: boolean;
  version: number;
  deletedAt: Date | null;
  _count?: { items: number };
}): MaterialLibraryCategoryDTO {
  return {
    id: category.id,
    code: category.code,
    name: category.name,
    sortOrder: category.sortOrder,
    isSystem: category.isSystem,
    version: category.version,
    itemCount: category._count?.items || 0,
    deletedAt: category.deletedAt?.toISOString() || null,
  };
}

export function serializeMaterialUploadLink(input: {
  id: string;
  materialItemId: string;
  mode: MaterialLibraryUploadMode;
  status: MaterialLibraryUploadLinkStatus;
  generation: number;
  expiresAt: Date | null;
  lastScannedAt: Date | null;
  createdAt: Date;
  latestSession: MaterialLibrarySessionRecord | null;
}): MaterialLibraryUploadLinkDTO {
  return {
    id: input.id,
    materialItemId: input.materialItemId,
    mode: input.mode,
    status: input.status,
    capturePath: materialUploadCapturePath(input),
    expiresAt: input.expiresAt?.toISOString() || null,
    lastScannedAt: input.lastScannedAt?.toISOString() || null,
    createdAt: input.createdAt.toISOString(),
    latestSession: input.latestSession ? serializeMaterialSession(input.latestSession) : null,
  };
}

export function materialSessionDraftData(body: Record<string, unknown>) {
  const warningState = materialWarningState(body.warningState);
  const warningNote = cleanMaterialText(body.warningNote, 500);
  if (warningState !== 'NONE' && !warningNote) {
    throw new MaterialLibraryError('设置不良品警示时请填写说明', 400, 'MATERIAL_WARNING_NOTE_REQUIRED');
  }
  return {
    categoryId: requiredMaterialText(body.categoryId, '分类', 80),
    draftManufacturerModel: cleanMaterialText(body.manufacturerModel, 160),
    draftSpecification: cleanMaterialText(body.specification, 240),
    draftMaterialComposition: cleanMaterialText(body.materialComposition, 240),
    draftSupplierName: cleanMaterialText(body.supplierName, 200),
    draftSupplierPartNumber: cleanMaterialText(body.supplierPartNumber, 160),
    draftBatchNumber: cleanMaterialText(body.batchNumber, 120),
    draftWarningState: warningState as MaterialLibraryWarningState,
    draftWarningNote: warningState === 'NONE' ? null : warningNote,
    draftNotes: cleanMaterialText(body.notes, 2_000),
  };
}

export function materialItemUpdateData(body: Record<string, unknown>) {
  const warningState = materialWarningState(body.warningState);
  const warningNote = cleanMaterialText(body.warningNote, 500);
  if (warningState !== 'NONE' && !warningNote) {
    throw new MaterialLibraryError('设置不良品警示时请填写说明', 400, 'MATERIAL_WARNING_NOTE_REQUIRED');
  }
  return {
    categoryId: requiredMaterialText(body.categoryId, '分类', 80),
    code: normalizeMaterialCode(body.code),
    name: requiredMaterialText(body.name, '物料名称', 160),
    manufacturerModel: cleanMaterialText(body.manufacturerModel, 160),
    specification: cleanMaterialText(body.specification, 240),
    materialComposition: cleanMaterialText(body.materialComposition, 240),
    supplierName: cleanMaterialText(body.supplierName, 200),
    supplierPartNumber: cleanMaterialText(body.supplierPartNumber, 160),
    batchNumber: cleanMaterialText(body.batchNumber, 120),
    warningState: warningState as MaterialLibraryWarningState,
    warningNote: warningState === 'NONE' ? null : warningNote,
    notes: cleanMaterialText(body.notes, 2_000),
  };
}

export function activeSessionStatus(value: string): boolean {
  return value === MaterialLibraryCaptureStatus.ACTIVE;
}
