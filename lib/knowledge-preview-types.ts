export type PreviewState = 'pending' | 'processing' | 'ready' | 'failed' | 'unavailable';
export type SheetMetadata = { name: string; rowCount: number; columnCount: number; widths: number[]; firstRow?: number; lastRow?: number; firstColumn?: number; nonEmptyCells?: number; error?: string };
export type PreviewSheet = SheetMetadata & { rows: { index: number; cells: Record<number, string> }[]; hiddenRows?: number[]; merges: { r: number; c: number; er: number; ec: number; value?: string }[] };
export type OfficePreviewStatus = {
  status: PreviewState; tableStatus: PreviewState; pdfStatus: PreviewState;
  tableError: string | null; pdfError: string | null;
  sheets: SheetMetadata[]; pdfUrl: string | null;
};
export type SheetPage = SheetMetadata & {
  rows: { index: number; cells: string[] }[]; merges: PreviewSheet['merges']; page: number; pageSize: number;
  header: { index: number; cells: string[] } | null;
  columnOffset: number; visibleColumns: number;
  totalRows: number; totalPages: number; query: string;
};
export const OFFICE_RENDERER_VERSION = 'office-v2-sparse-gotenberg-8.38.1';
export const isOfficeFile = (type: string) => ['xls', 'xlsx', 'doc', 'docx'].includes(type.toLowerCase());
export const isExcelFile = (type: string) => ['xls', 'xlsx'].includes(type.toLowerCase());
