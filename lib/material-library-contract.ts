export type MaterialLibraryWarningStateDTO = 'NONE' | 'ATTENTION' | 'DEFECT';
export type MaterialLibraryItemStatusDTO = 'ACTIVE' | 'INACTIVE';
export type MaterialLibraryUploadModeDTO = 'TEMPORARY' | 'PERMANENT';
export type MaterialLibraryUploadLinkStatusDTO = 'ACTIVE' | 'REVOKED';
export type MaterialLibraryCaptureStatusDTO = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export type MaterialLibraryCategoryDTO = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isSystem: boolean;
  version: number;
  itemCount: number;
  deletedAt: string | null;
};

export type MaterialLibraryPhotoDTO = {
  id: string;
  sessionId: string;
  materialItemId: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  rotation: number;
  sortOrder: number;
  isCover: boolean;
  caption: string | null;
  captureSource: string | null;
  uploadedBy: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  contentUrl: string;
};

export type MaterialLibraryItemDTO = {
  id: string;
  categoryId: string;
  category: Pick<MaterialLibraryCategoryDTO, 'id' | 'code' | 'name'>;
  code: string;
  name: string;
  manufacturerModel: string | null;
  specification: string | null;
  materialComposition: string | null;
  supplierName: string | null;
  supplierPartNumber: string | null;
  batchNumber: string | null;
  warningState: MaterialLibraryWarningStateDTO;
  warningNote: string | null;
  status: MaterialLibraryItemStatusDTO;
  notes: string | null;
  version: number;
  lastCapturedAt: string | null;
  deletedAt: string | null;
  deletedReason: string | null;
  createdAt: string;
  updatedAt: string;
  photos: MaterialLibraryPhotoDTO[];
  photoCount: number;
  coverPhoto: MaterialLibraryPhotoDTO | null;
  dataComplete: boolean;
};

export type MaterialLibrarySummaryDTO = {
  active: number;
  incomplete: number;
  warnings: number;
  recycled: number;
};

export type MaterialLibraryCaptureSessionDTO = {
  id: string;
  sessionNo: string;
  uploadLinkId: string;
  uploadMode: MaterialLibraryUploadModeDTO;
  uploadLinkStatus: MaterialLibraryUploadLinkStatusDTO;
  uploadLinkExpiresAt: string | null;
  materialItemId: string;
  categoryId: string;
  status: MaterialLibraryCaptureStatusDTO;
  draftManufacturerModel: string | null;
  draftSpecification: string | null;
  draftMaterialComposition: string | null;
  draftSupplierName: string | null;
  draftSupplierPartNumber: string | null;
  draftBatchNumber: string | null;
  draftWarningState: MaterialLibraryWarningStateDTO;
  draftWarningNote: string | null;
  draftNotes: string | null;
  version: number;
  connectedById: string | null;
  connectedByName: string | null;
  connectedAt: string | null;
  lastSeenAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  item: MaterialLibraryItemDTO;
  photos: MaterialLibraryPhotoDTO[];
};

export type MaterialLibraryUploadLinkDTO = {
  id: string;
  materialItemId: string;
  mode: MaterialLibraryUploadModeDTO;
  status: MaterialLibraryUploadLinkStatusDTO;
  capturePath: string;
  expiresAt: string | null;
  lastScannedAt: string | null;
  createdAt: string;
  latestSession: MaterialLibraryCaptureSessionDTO | null;
};
