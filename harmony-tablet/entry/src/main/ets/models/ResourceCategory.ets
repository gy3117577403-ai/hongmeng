export interface ResourceCategory {
  id: string;
  code: string;
  name: string;
  required: boolean;
  sortOrder: number;
  fileCount?: number;
}
