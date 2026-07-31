export const SOP_SCHEMA_VERSION = 1 as const;

export type SopNodeType =
  | 'doc'
  | 'paragraph'
  | 'heading'
  | 'text'
  | 'image'
  | 'bulletList'
  | 'orderedList'
  | 'listItem'
  | 'table'
  | 'tableRow'
  | 'tableCell'
  | 'tableHeader'
  | 'hardBreak'
  | 'pageBreak';

export type SopNodeAttrs = {
  level?: 1 | 2 | 3;
  variant?: 'default' | 'warning' | 'checklist' | 'steps';
  title?: string;
  checked?: boolean;
  assetId?: string;
  alt?: string;
  caption?: string;
  widthPercent?: number;
  align?: 'left' | 'center' | 'right';
  [key: string]: string | number | boolean | null | undefined;
};

export type SopNode = {
  type: SopNodeType;
  text?: string;
  attrs?: SopNodeAttrs;
  content?: SopNode[];
};

export type SopDocument = {
  type: 'doc';
  schemaVersion: typeof SOP_SCHEMA_VERSION;
  content: SopNode[];
};

export type SopAsset = {
  id: string;
  documentId?: string;
  originalName: string;
  displayName?: string | null;
  mimeType: string;
  size: number;
  fileHash?: string | null;
  uploadedBy?: SopActor | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  url: string;
};

export type SopActor = {
  id: string;
  username: string;
  displayName: string;
};

export type SopPublishedFile = {
  id: string;
  originalName: string;
  displayName?: string | null;
  mimeType: string;
  size: number;
  version: string;
  deletedAt?: string | null;
  createdAt?: string | null;
  contentUrl?: string;
  downloadUrl?: string;
};

export type SopVersionStatus = 'draft' | 'published';

export type SopVersion = {
  id: string;
  documentId?: string;
  /** Immutable business version displayed as V1, V2, ... */
  version: number;
  /** Optimistic-concurrency counter. Never use this as a display label. */
  revision: number;
  status: SopVersionStatus;
  title: string;
  content: SopDocument;
  contentSchemaVersion: number;
  basedOnVersionId?: string | null;
  createdBy?: SopActor | null;
  updatedBy?: SopActor | null;
  publishedBy?: SopActor | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  publishedAt?: string | null;
  deletedAt?: string | null;
  publishedFile?: SopPublishedFile | null;
};

export type SopWorkspaceItem = {
  id: string;
  customerName: string;
  productName?: string | null;
  specification: string;
  libraryKey: string;
};

export type SopWorkspaceDocument = {
  id: string;
  drawingLibraryItemId: string;
  title: string;
  currentPublishedVersionId?: string | null;
  createdBy?: SopActor | null;
  updatedBy?: SopActor | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type SopWorkspace = {
  item: SopWorkspaceItem;
  document: SopWorkspaceDocument | null;
  itemId: string;
  title?: string;
  draft: SopVersion | null;
  publishedVersion: SopVersion | null;
  versions: SopVersion[];
  assets: SopAsset[];
};

export type SaveDraftInput = {
  versionId?: string;
  title: string;
  content: SopDocument;
  expectedRevision?: number | null;
};

export type PublishSopInput = {
  versionId: string;
  expectedRevision: number;
  title: string;
  pdf: Blob;
};

export interface SopApiAdapter {
  load(): Promise<SopWorkspace>;
  saveDraft(input: SaveDraftInput): Promise<SopVersion>;
  uploadAsset(file: File, versionId?: string): Promise<SopAsset>;
  deleteAsset(assetId: string): Promise<void>;
  publish(input: PublishSopInput): Promise<SopWorkspace>;
  restore(versionId: string): Promise<SopVersion>;
  deleteDraft(versionId: string, expectedRevision: number): Promise<void>;
}

export function inlineContentFromText(value: string): SopNode[] {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  const content: SopNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: 'hardBreak' });
    if (line) content.push({ type: 'text', text: line });
  });
  return content;
}

export function textFromInlineContent(content: SopNode[] | undefined): string {
  return (content || []).map(node => node.type === 'hardBreak' ? '\n' : node.type === 'text' ? node.text || '' : '').join('');
}

export function paragraph(text = '', attrs?: SopNodeAttrs): SopNode {
  return { type: 'paragraph', attrs, content: inlineContentFromText(text) };
}

export function listItem(text = '', checked?: boolean): SopNode {
  return { type: 'listItem', attrs: checked === undefined ? undefined : { checked }, content: [paragraph(text)] };
}

export function tableCell(text = '', header = false): SopNode {
  return { type: header ? 'tableHeader' : 'tableCell', content: [paragraph(text)] };
}

export function createEmptySopDocument(title = '新建 SOP 作业指导书'): SopDocument {
  return {
    type: 'doc',
    schemaVersion: SOP_SCHEMA_VERSION,
    content: [
      { type: 'heading', attrs: { level: 1 }, content: inlineContentFromText(title) },
      paragraph('在这里填写适用范围、作业目的和准备条件。'),
    ],
  };
}

export function normalizeSopDocument(value: unknown, fallbackTitle?: string): SopDocument {
  if (!value || typeof value !== 'object') return createEmptySopDocument(fallbackTitle);
  const candidate = value as Partial<SopDocument>;
  if (candidate.type !== 'doc' || !Array.isArray(candidate.content)) return createEmptySopDocument(fallbackTitle);
  return {
    type: 'doc',
    schemaVersion: SOP_SCHEMA_VERSION,
    content: candidate.content.filter(node => Boolean(node && typeof node === 'object' && typeof node.type === 'string')),
  };
}
