import { httpClient, NativeApiBaseResponse } from './httpClient';
import type { ResourceCategory } from '../models/ResourceCategory';
import type { ResourceFile } from '../models/ResourceFile';
import type { WorkOrder } from '../models/WorkOrder';

export interface WorkOrderListData {
  workOrders: WorkOrder[];
  page: number;
  pageSize: number;
  total: number;
}

export interface WorkOrderListResponse extends NativeApiBaseResponse {
  data: WorkOrderListData;
}

export interface WorkOrderDetailData {
  workOrder: WorkOrder;
}

export interface WorkOrderDetailResponse extends NativeApiBaseResponse {
  data: WorkOrderDetailData;
}

export interface WorkOrderResourcesData {
  categories: ResourceCategory[];
  files: ResourceFile[];
}

export interface WorkOrderResourcesResponse extends NativeApiBaseResponse {
  data: WorkOrderResourcesData;
}

export interface WorkOrderUpdateRequest {
  code?: string;
  customerName?: string;
  productName?: string;
  stage?: string;
  priority?: string;
  progress?: number;
  plannedAt?: string;
  remark?: string;
}

export async function fetchWorkOrders(keyword: string = '', page: number = 1): Promise<WorkOrderListData> {
  const q = encodeURIComponent(keyword);
  const response = await httpClient.get(`/api/native/work-orders?page=${page}&pageSize=40&keyword=${q}`);
  const parsed = JSON.parse(response.text) as WorkOrderListResponse;
  return parsed.data;
}

export async function fetchWorkOrder(id: string): Promise<WorkOrderDetailData> {
  const response = await httpClient.get(`/api/native/work-orders/${id}`);
  const parsed = JSON.parse(response.text) as WorkOrderDetailResponse;
  return parsed.data;
}

export async function updateWorkOrder(id: string, body: WorkOrderUpdateRequest): Promise<WorkOrderDetailData> {
  const response = await httpClient.patch(`/api/native/work-orders/${id}`, JSON.stringify(body));
  const parsed = JSON.parse(response.text) as WorkOrderDetailResponse;
  return parsed.data;
}

export async function fetchWorkOrderResources(id: string): Promise<WorkOrderResourcesData> {
  const response = await httpClient.get(`/api/native/work-orders/${id}/resources`);
  const parsed = JSON.parse(response.text) as WorkOrderResourcesResponse;
  return parsed.data;
}
