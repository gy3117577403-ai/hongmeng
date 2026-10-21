export type PreviewState = 'pending' | 'processing' | 'ready' | 'failed' | 'unavailable';
export type SheetMetadata = { name: string; rowCount: number; columnCount: number; widths: number[] };
export type PreviewSheet = SheetMetadata & { rows: { index: number; cells: string[] }[]; merges: { r: number; c: number; er: number; ec: number }[] };
export type OfficePreviewStatus = {
  status: PreviewState; tableStatus: PreviewState; pdfStatus: PreviewState;
  tableError: string | null; pdfError: string | null;
  sheets: SheetMetadata[]; pdfUrl: string | null;
};
export type SheetPage = SheetMetadata & {
  rows: PreviewSheet['rows']; merges: PreviewSheet['merges']; page: number; pageSize: number;
  header: PreviewSheet['rows'][number] | null;
  totalRows: number; totalPages: number; query: string;
};
export const OFFICE_RENDERER_VERSION = 'office-v1-gotenberg-8.38.1';
export const isOfficeFile = (type: string) => ['xls', 'xlsx', 'doc', 'docx'].includes(type.toLowerCase());
export const isExcelFile = (type: string) => ['xls', 'xlsx'].includes(type.toLowerCase());
