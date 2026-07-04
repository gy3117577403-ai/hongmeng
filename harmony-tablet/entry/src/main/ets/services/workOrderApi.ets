import { httpClient } from './httpClient';
import type { ResourceCategory } from '../models/ResourceCategory';
import type { ResourceFile } from '../models/ResourceFile';
import type { WorkOrder } from '../models/WorkOrder';

export interface WorkOrderListData {
  workOrders: WorkOrder[];
  page: number;
  pageSize: number;
  total: number;
}

export interface WorkOrderResourcesData {
  categories: ResourceCategory[];
  files: ResourceFile[];
}

export async function fetchWorkOrders(keyword: string = '', page: number = 1): Promise<WorkOrderListData> {
  const q = encodeURIComponent(keyword);
  return httpClient.get<WorkOrderListData>(`/api/native/work-orders?page=${page}&pageSize=40&keyword=${q}`);
}

export async function fetchWorkOrder(id: string): Promise<{ workOrder: WorkOrder }> {
  return httpClient.get<{ workOrder: WorkOrder }>(`/api/native/work-orders/${id}`);
}

export async function updateWorkOrder(id: string, body: object): Promise<{ workOrder: WorkOrder }> {
  return httpClient.patch<{ workOrder: WorkOrder }>(`/api/native/work-orders/${id}`, body);
}

export async function fetchWorkOrderResources(id: string): Promise<WorkOrderResourcesData> {
  return httpClient.get<WorkOrderResourcesData>(`/api/native/work-orders/${id}/resources`);
}
