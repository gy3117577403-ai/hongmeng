import type { Prisma } from '@prisma/client';

export const SOP_CONTENT_SCHEMA_VERSION = 1;
export const SOP_DRAFT_STATUS = 'draft';
export const SOP_PUBLISHED_STATUS = 'published';
export const SOP_MAX_NODES = 5_000;
export const SOP_MAX_DEPTH = 20;
export const SOP_MAX_TEXT_LENGTH = 500_000;
export const SOP_MAX_JSON_BYTES = 2 * 1024 * 1024;
export const SOP_WRITE_ACCESS = 'self' as const;

const ALLOWED_NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'heading',
  'text',
  'image',
  'bulletList',
  'orderedList',
  'listItem',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'hardBreak',
  'pageBreak',
]);

const ALLOWED_MARK_TYPES = new Set(['bold', 'italic', 'underline', 'strike', 'link', 'textStyle']);
const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);
const BLOCK_VARIANTS = new Set(['normal', 'warning', 'checklist', 'steps']);

export type SopJsonMark = {
  type: string;
  attrs?: Record<string, string | number | boolean>;
};

export type SopJsonNode = {
  type: string;
  attrs?: Record<string, string | number | boolean | null>;
  content?: SopJsonNode[];
  text?: string;
  marks?: SopJsonMark[];
};

export type SopDocumentContent = SopJsonNode & {
  type: 'doc';
  schemaVersion: 1;
  content: SopJsonNode[];
};

export const EMPTY_SOP_CONTENT: SopDocumentContent = Object.freeze({
  type: 'doc',
  schemaVersion: SOP_CONTENT_SCHEMA_VERSION,
  content: [{ type: 'paragraph', content: [] }],
}) as SopDocumentContent;

export class SopRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: unknown;

  constructor(message: string, status = 400, code = 'SOP_INVALID_REQUEST', detail?: unknown) {
    super(message);
    this.name = 'SopRequestError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown, field: string, max: number, allowEmpty = true): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new SopRequestError(`${field} 格式无效`);
  const text = value.trim();
  if (!allowEmpty && !text) throw new SopRequestError(`${field} 不能为空`);
  if (text.length > max) throw new SopRequestError(`${field} 不能超过 ${max} 个字符`);
  return text;
}

function cleanInteger(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new SopRequestError(`${field} 格式无效`);
  }
  return value;
}

function cleanAlignment(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !ALIGNMENTS.has(value)) throw new SopRequestError('对齐方式无效');
  return value;
}

function normalizeAttrs(type: string, raw: unknown): SopJsonNode['attrs'] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) throw new SopRequestError(`${type} 节点属性格式无效`);
  const attrs: NonNullable<SopJsonNode['attrs']> = {};

  if (type === 'paragraph') {
    const align = cleanAlignment(raw.align);
    if (align) attrs.align = align;
    if (raw.variant !== undefined) {
      if (typeof raw.variant !== 'string' || !BLOCK_VARIANTS.has(raw.variant)) throw new SopRequestError('段落样式无效');
      attrs.variant = raw.variant;
    }
    const indent = cleanInteger(raw.indent, '段落缩进', 0, 8);
    if (indent !== undefined) attrs.indent = indent;
  } else if (type === 'heading') {
    attrs.level = cleanInteger(raw.level ?? 2, '标题级别', 1, 6) ?? 2;
    const align = cleanAlignment(raw.align);
    if (align) attrs.align = align;
  } else if (type === 'image') {
    const assetId = cleanString(raw.assetId, '图片素材', 128, false);
    if (!assetId || !/^[a-zA-Z0-9_-]{8,128}$/.test(assetId)) throw new SopRequestError('图片素材标识无效');
    attrs.assetId = assetId;
    for (const key of ['alt', 'caption', 'title'] as const) {
      const value = cleanString(raw[key], `图片${key}`, 500);
      if (value !== undefined) attrs[key] = value;
    }
    const widthPercent = cleanInteger(raw.widthPercent, '图片宽度比例', 10, 100);
    if (widthPercent !== undefined) attrs.widthPercent = widthPercent;
    const width = cleanInteger(raw.width, '图片宽度', 40, 4_000);
    if (width !== undefined) attrs.width = width;
    const align = cleanAlignment(raw.align);
    if (align) attrs.align = align;
  } else if (type === 'bulletList' || type === 'orderedList') {
    if (raw.variant !== undefined) {
      if (typeof raw.variant !== 'string' || !BLOCK_VARIANTS.has(raw.variant)) throw new SopRequestError('列表样式无效');
      attrs.variant = raw.variant;
    }
    if (type === 'orderedList') {
      const start = cleanInteger(raw.start, '列表起始序号', 1, 999);
      if (start !== undefined) attrs.start = start;
    }
  } else if (type === 'listItem') {
    if (raw.checked !== undefined) {
      if (typeof raw.checked !== 'boolean') throw new SopRequestError('清单勾选状态无效');
      attrs.checked = raw.checked;
    }
  } else if (type === 'tableCell' || type === 'tableHeader') {
    const colspan = cleanInteger(raw.colspan, '合并列数', 1, 20);
    const rowspan = cleanInteger(raw.rowspan, '合并行数', 1, 100);
    if (colspan !== undefined) attrs.colspan = colspan;
    if (rowspan !== undefined) attrs.rowspan = rowspan;
    const backgroundColor = cleanString(raw.backgroundColor, '单元格背景色', 32);
    if (backgroundColor !== undefined) attrs.backgroundColor = backgroundColor;
  }

  return Object.keys(attrs).length ? attrs : undefined;
}

function normalizeMarks(raw: unknown): SopJsonMark[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new SopRequestError('文字样式格式无效');
  if (raw.length > 8) throw new SopRequestError('单段文字样式过多');
  const marks = raw.map(value => {
    if (!isRecord(value) || typeof value.type !== 'string' || !ALLOWED_MARK_TYPES.has(value.type)) {
      throw new SopRequestError('包含不支持的文字样式');
    }
    const mark: SopJsonMark = { type: value.type };
    if (value.type === 'link') {
      if (!isRecord(value.attrs)) throw new SopRequestError('链接格式无效');
      const href = cleanString(value.attrs.href, '链接地址', 2_000, false);
      if (!href || !/^(https?:|mailto:|tel:)/i.test(href)) throw new SopRequestError('仅支持安全的 HTTP、邮件或电话链接');
      mark.attrs = { href };
    } else if (value.type === 'textStyle') {
      if (!isRecord(value.attrs)) throw new SopRequestError('文字样式属性无效');
      const attrs: Record<string, string | number | boolean> = {};
      const color = cleanString(value.attrs.color, '文字颜色', 32);
      const backgroundColor = cleanString(value.attrs.backgroundColor, '文字背景色', 32);
      const fontSize = cleanInteger(value.attrs.fontSize, '字号', 8, 96);
      if (color !== undefined) attrs.color = color;
      if (backgroundColor !== undefined) attrs.backgroundColor = backgroundColor;
      if (fontSize !== undefined) attrs.fontSize = fontSize;
      if (Object.keys(attrs).length) mark.attrs = attrs;
    }
    return mark;
  });
  return marks.length ? marks : undefined;
}

function validateChildKinds(type: string, children: SopJsonNode[]) {
  const childTypes = new Set(children.map(child => child.type));
  if ((type === 'bulletList' || type === 'orderedList') && [...childTypes].some(child => child !== 'listItem')) {
    throw new SopRequestError('列表中只能包含列表项');
  }
  if (type === 'table' && [...childTypes].some(child => child !== 'tableRow')) {
    throw new SopRequestError('表格中只能包含表格行');
  }
  if (type === 'tableRow' && [...childTypes].some(child => child !== 'tableCell' && child !== 'tableHeader')) {
    throw new SopRequestError('表格行中只能包含单元格');
  }
}

export function validateSopContent(input: unknown): SopDocumentContent {
  if (!isRecord(input) || input.type !== 'doc') throw new SopRequestError('SOP 正文必须是 doc 文档树');
  if (input.schemaVersion !== SOP_CONTENT_SCHEMA_VERSION) {
    throw new SopRequestError(`不支持的 SOP 内容版本，仅支持 V${SOP_CONTENT_SCHEMA_VERSION}`);
  }
  const encoded = JSON.stringify(input);
  if (Buffer.byteLength(encoded, 'utf8') > SOP_MAX_JSON_BYTES) throw new SopRequestError('SOP 正文不能超过 2MB');

  let nodeCount = 0;
  let textLength = 0;
  const normalizeNode = (value: unknown, depth: number, isRoot = false): SopJsonNode => {
    if (depth > SOP_MAX_DEPTH) throw new SopRequestError(`SOP 内容嵌套不能超过 ${SOP_MAX_DEPTH} 层`);
    if (!isRecord(value) || typeof value.type !== 'string' || !ALLOWED_NODE_TYPES.has(value.type)) {
      throw new SopRequestError('SOP 中包含不支持的内容节点');
    }
    if (isRoot && value.type !== 'doc') throw new SopRequestError('SOP 根节点必须是 doc');
    if (!isRoot && value.type === 'doc') throw new SopRequestError('SOP 正文中不能嵌套 doc 节点');
    nodeCount += 1;
    if (nodeCount > SOP_MAX_NODES) throw new SopRequestError(`SOP 内容节点不能超过 ${SOP_MAX_NODES} 个`);

    const node: SopJsonNode = { type: value.type };
    const attrs = normalizeAttrs(value.type, value.attrs);
    if (attrs) node.attrs = attrs;

    if (value.type === 'text') {
      if (typeof value.text !== 'string') throw new SopRequestError('文字节点缺少正文');
      textLength += value.text.length;
      if (textLength > SOP_MAX_TEXT_LENGTH) throw new SopRequestError('SOP 文字总量过大');
      node.text = value.text;
      const marks = normalizeMarks(value.marks);
      if (marks) node.marks = marks;
      if (value.content !== undefined) throw new SopRequestError('文字节点不能包含子节点');
      return node;
    }

    if (value.text !== undefined || value.marks !== undefined) throw new SopRequestError(`${value.type} 节点不能直接包含文字属性`);
    const leaf = value.type === 'image' || value.type === 'hardBreak' || value.type === 'pageBreak';
    if (leaf) {
      if (value.content !== undefined) throw new SopRequestError(`${value.type} 节点不能包含子节点`);
      return node;
    }

    if (value.content !== undefined && !Array.isArray(value.content)) throw new SopRequestError(`${value.type} 节点内容格式无效`);
    const children = (Array.isArray(value.content) ? value.content : []).map(child => normalizeNode(child, depth + 1));
    validateChildKinds(value.type, children);
    node.content = children;
    return node;
  };

  const root = normalizeNode(input, 0, true) as SopDocumentContent;
  root.schemaVersion = SOP_CONTENT_SCHEMA_VERSION;
  root.content ||= [];
  return root;
}

export function collectSopAssetIds(content: unknown): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (!isRecord(value)) return;
    if (value.type === 'image' && isRecord(value.attrs) && typeof value.attrs.assetId === 'string') ids.add(value.attrs.assetId);
    if (Array.isArray(value.content)) value.content.forEach(visit);
  };
  visit(content);
  return [...ids];
}

export function cloneSopContent(content: SopDocumentContent): SopDocumentContent {
  return JSON.parse(JSON.stringify(content)) as SopDocumentContent;
}

export function parseExpectedRevision(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0) throw new SopRequestError('expectedRevision 必须是非负整数');
  return parsed;
}

export function assertExpectedRevision(actual: number, expected: number) {
  if (actual !== expected) {
    throw new SopRequestError('文档已被其他人更新，请刷新后合并修改', 409, 'SOP_REVISION_CONFLICT', {
      expectedRevision: expected,
      actualRevision: actual,
    });
  }
}

export function assertMutableDraft(input: { status: string; deletedAt?: Date | null }) {
  if (input.deletedAt) throw new SopRequestError('该草稿已删除', 409, 'SOP_DRAFT_DELETED');
  if (input.status !== SOP_DRAFT_STATUS) {
    throw new SopRequestError('已发布版本不可修改，请恢复为新草稿后编辑', 409, 'SOP_PUBLISHED_IMMUTABLE');
  }
}

export function nextDrawingLibraryMinorVersion(versions: Array<string | null | undefined>): string {
  const maxMinor = versions.reduce((current, value) => {
    const match = String(value || '').match(/^V1\.(\d+)$/i);
    return match ? Math.max(current, Number(match[1])) : current;
  }, -1);
  return `V1.${maxMinor + 1}`;
}

export function isOnlineGeneratedSopFile(input: { sourceSopVersionId?: string | null }): boolean {
  return Boolean(input.sourceSopVersionId);
}

export type CommonDrawingFileLifecycleAction = 'update' | 'delete' | 'restore';

export function assertCommonDrawingFileLifecycleAllowed(
  input: { sourceSopVersionId?: string | null },
  action: CommonDrawingFileLifecycleAction,
) {
  if (!isOnlineGeneratedSopFile(input)) return;
  throw new SopRequestError(
    '在线生成的 SOP 文件由 SOP 版本管理，请在 SOP 编辑器中发布新版本；通用文件操作不允许修改、删除或恢复该文件。',
    409,
    'SOP_GENERATED_FILE_MANAGED_BY_VERSION',
    { action },
  );
}

export function onlineGeneratedSopFileIdsToArchive(
  files: Array<{ id: string; sourceSopVersionId?: string | null; deletedAt?: Date | null }>,
): string[] {
  return files.filter(file => !file.deletedAt && isOnlineGeneratedSopFile(file)).map(file => file.id);
}

export function isSopReadyFromPublishedVersion(input: {
  status?: string | null;
  deletedAt?: Date | null;
  publishedFile?: { deletedAt?: Date | null } | null;
} | null | undefined): boolean {
  return Boolean(input && input.status === SOP_PUBLISHED_STATUS && !input.deletedAt && input.publishedFile && !input.publishedFile.deletedAt);
}

export function toPrismaJson(content: SopDocumentContent): Prisma.InputJsonValue {
  return content as unknown as Prisma.InputJsonValue;
}
