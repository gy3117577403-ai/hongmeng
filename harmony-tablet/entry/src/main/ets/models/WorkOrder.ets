export interface WorkOrder {
  id: string;
  code: string;
  customerName?: string | null;
  productName: string;
  stage: string;
  stageText?: string;
  priority: string;
  status: string;
  progress: number;
  plannedAt?: string | null;
  remark?: string | null;
  categoryFileCounts?: Record<string, number>;
  totalFileCount?: number;
}
