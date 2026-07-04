export interface ResourceFile {
  id: string;
  workOrderId: string;
  categoryId: string;
  categoryName?: string | null;
  categoryCode?: string | null;
  originalName: string;
  displayName?: string | null;
  remark?: string | null;
  mimeType: string;
  fileType: string;
  fileSize: number;
  version: string;
  status: string;
  uploadedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  contentUrl: string;
  downloadUrl: string;
}
