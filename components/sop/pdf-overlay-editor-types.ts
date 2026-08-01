export const PDF_OVERLAY_SCHEMA_VERSION = 1 as const;

export type PdfOverlayTool =
  | 'select'
  | 'text'
  | 'image'
  | 'rectangle'
  | 'arrow'
  | 'pen'
  | 'highlight'
  | 'cover';

export type PdfOverlayPoint = {
  /** Horizontal position relative to the PDF page, from 0 to 1. */
  x: number;
  /** Vertical position relative to the PDF page, from 0 to 1. */
  y: number;
};

export type PdfOverlayAnnotationStyle = {
  stroke: string;
  fill: string;
  textColor: string;
  opacity: number;
  strokeWidth: number;
  fontSize: number;
};

/**
 * Overlay-only annotation data. Coordinates are normalized so the same draft
 * can be rendered on any screen size and later flattened onto the source PDF.
 */
export type PdfOverlayAnnotation = {
  id: string;
  page: number;
  kind: Exclude<PdfOverlayTool, 'select'>;
  x: number;
  y: number;
  width: number;
  height: number;
  endX?: number;
  endY?: number;
  points?: PdfOverlayPoint[];
  text?: string;
  imageSrc?: string;
  imageAssetId?: string;
  style: PdfOverlayAnnotationStyle;
  zIndex: number;
  hidden?: boolean;
  locked?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PdfOverlayDocument = {
  schemaVersion: typeof PDF_OVERLAY_SCHEMA_VERSION;
  /** Stable drawing-library/product record identifier. */
  sourceId?: string;
  /** Immutable identifier of the PDF file revision used as the overlay base. */
  baseFileId?: string;
  sourceFileName: string;
  pageCount: number;
  annotations: PdfOverlayAnnotation[];
  revision?: number;
  updatedAt: string;
};

export type PdfOverlayUploadedImage = {
  url: string;
  assetId?: string;
};

export type PdfOverlayPageSize = {
  page: number;
  /** Original PDF page width in points. */
  width: number;
  /** Original PDF page height in points. */
  height: number;
};

export type PdfOverlayPageImage = PdfOverlayPageSize & {
  /** Transparent PNG containing only the user-created overlay layer. */
  pngDataUrl: string;
};

export type PdfOverlayPublishPayload = {
  document: PdfOverlayDocument;
  overlays: PdfOverlayPageImage[];
};

/**
 * Persistence callbacks must return the server-issued revision. This prevents
 * a second save (or save-then-publish) from reusing a stale optimistic-lock
 * revision and receiving a 409 conflict.
 */
export type PdfOverlayPersistenceResult =
  | { revision: number; updatedAt?: string }
  | (PdfOverlayDocument & { revision: number });

export type PdfOverlayEditorModalProps = {
  open: boolean;
  sourceUrl?: string | null;
  sourceFile?: Blob | ArrayBuffer | Uint8Array | null;
  /** Stable identifier used when the source URL is short-lived. */
  sourceId?: string;
  /** Stable identifier of the exact source PDF file/version being edited. */
  baseFileId?: string;
  fileName: string;
  title?: string;
  versionLabel?: string;
  initialDocument?: PdfOverlayDocument | null;
  onClose: () => void;
  onSave?: (document: PdfOverlayDocument) => Promise<PdfOverlayPersistenceResult> | PdfOverlayPersistenceResult;
  /**
   * Publishing receives the editable JSON plus one transparent PNG per edited
   * page. The business layer can flatten those PNGs with pdf-lib while keeping
   * the source PDF untouched and fully vector-preserved.
   */
  onPublish?: (payload: PdfOverlayPublishPayload) => Promise<PdfOverlayPersistenceResult> | PdfOverlayPersistenceResult;
  onUploadImage?: (file: File) => Promise<PdfOverlayUploadedImage>;
  /** Set to a positive value to enable callback-driven autosave. */
  autoSaveDelayMs?: number;
};
