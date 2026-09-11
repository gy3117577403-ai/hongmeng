export type QuickQualityState = 'SAVED' | 'ACTIVE' | 'OFFLINE';
export type QuickQualityPhoto = { id: string; name: string; url: string; imageWidth: number; imageHeight: number; mimeType?: string };
export type QuickDrawingOption = {id:string;customerName:string;productName:string|null;specification:string};
export type QuickQualityDTO = {
  id: string; number: string; description: string; state: QuickQualityState; scope: 'WORK_ORDER' | 'PRODUCT';
  version: number; createdAt: string; updatedAt: string; occurredAt: string; author: string;
  processName: string; effectiveUntil: string | null; deletedAt: string | null; printPolicy: string;
  productId: string | null; productName: string; scopeChanged: boolean; escalatedReportId: string | null;
  drawing?: QuickDrawingOption | null; needsAssociation?:boolean;
  orders: Array<{ id: string; code: string; productName: string; specification: string }>;
  photos: QuickQualityPhoto[];
  activities?: Array<{ id: string; action: string; actor: string; reason: string; createdAt: string; version: number; snapshot: unknown }>;
};
export const quickStateText = { SAVED: '仅记录', ACTIVE: '警示中', OFFLINE: '已下线' };
export const quickActionText: Record<string, string> = { SAVE: '保存记录', PUBLISH: '发布警示', EDIT: '更新记录', OFFLINE: '下线警示', DELETE: '移入回收站', RESTORE: '恢复记录', ESCALATE: '转为重大异常', DRAWING_LINK_MIGRATED:'补齐图纸关联' };
