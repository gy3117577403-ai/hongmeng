import { ApiException, httpClient, NativeApiBaseResponse } from './httpClient';
import type { ResourceCategory } from '../models/ResourceCategory';
import type { ResourceFile } from '../models/ResourceFile';
import type { WorkOrder } from '../models/WorkOrder';

export interface WorkOrderListData {
  workOrders: WorkOrder[];
  page: number;
  pageSize: number;
  total: number;
}

export interface WorkOrderListPayload {
  workOrders?: WorkOrder[];
  items?: WorkOrder[];
  list?: WorkOrder[];
  page?: number;
  pageSize?: number;
  total?: number;
}

export interface WorkOrderListResponse extends NativeApiBaseResponse {
  data?: WorkOrderListPayload | WorkOrder[];
  workOrders?: WorkOrder[];
  items?: WorkOrder[];
  page?: number;
  pageSize?: number;
  total?: number;
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

export interface WorkOrderResourcesPayload {
  categories?: ResourceCategory[];
  files?: ResourceFile[];
  resourceCategories?: ResourceCategory[];
  resourceFiles?: ResourceFile[];
}

export interface WorkOrderResourcesResponse extends NativeApiBaseResponse {
  data?: WorkOrderResourcesPayload | ResourceFile[];
  categories?: ResourceCategory[];
  files?: ResourceFile[];
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

export interface WorkOrderCreateRequest {
  code: string;
  customerName: string;
  productName: string;
  stage: string;
  priority: string;
  progress: number;
  plannedAt: string;
  remark: string;
}

export interface ConfirmDeleteRequest {
  confirmText: string;
}

export async function fetchWorkOrders(keyword: string = '', page: number = 1): Promise<WorkOrderListData> {
  const q = encodeURIComponent(keyword);
  const response = await httpClient.get(`/api/native/work-orders?page=${page}&pageSize=50&keyword=${q}`);
  const parsed = JSON.parse(response.text) as WorkOrderListResponse;
  return normalizeWorkOrderList(parsed);
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

export async function createWorkOrder(body: WorkOrderCreateRequest): Promise<WorkOrderDetailData> {
  const response = await httpClient.post('/api/native/work-orders', JSON.stringify(body));
  const parsed = JSON.parse(response.text) as WorkOrderDetailResponse;
  return parsed.data;
}

export async function deleteWorkOrder(id: string, confirmText: string): Promise<void> {
  const body: ConfirmDeleteRequest = { confirmText: confirmText };
  await httpClient.delete(`/api/native/work-orders/${id}`, JSON.stringify(body));
}

export async function restoreWorkOrder(id: string): Promise<WorkOrderDetailData> {
  const response = await httpClient.post(`/api/native/work-orders/${id}/restore`);
  const parsed = JSON.parse(response.text) as WorkOrderDetailResponse;
  return parsed.data;
}

export function downloadAllUrl(id: string): string {
  return httpClient.contentUrl(`/api/native/work-orders/${id}/download-all`);
}

export async function fetchWorkOrderResources(id: string): Promise<WorkOrderResourcesData> {
  const response = await httpClient.get(`/api/native/work-orders/${id}/resources`);
  const parsed = JSON.parse(response.text) as WorkOrderResourcesResponse;
  return normalizeWorkOrderResources(parsed);
}

function normalizeWorkOrderList(response: WorkOrderListResponse): WorkOrderListData {
  const payload = response.data;
  let workOrders: WorkOrder[] = [];
  let page = response.page || 1;
  let pageSize = response.pageSize || 50;
  let total = response.total || 0;
  let recognized = false;

  if (payload) {
    if (Array.isArray(payload)) {
      workOrders = payload;
      recognized = true;
    } else {
      if (payload.workOrders) {
        workOrders = payload.workOrders;
        recognized = true;
      } else if (payload.items) {
        workOrders = payload.items;
        recognized = true;
      } else if (payload.list) {
        workOrders = payload.list;
        recognized = true;
      }
      page = payload.page || page;
      pageSize = payload.pageSize || pageSize;
      total = payload.total || total;
    }
  } else if (response.workOrders) {
    workOrders = response.workOrders;
    recognized = true;
  } else if (response.items) {
    workOrders = response.items;
    recognized = true;
  }

  if (!recognized) {
    throw new ApiException('工单接口返回格式异常');
  }

  if (total === 0) {
    total = workOrders.length;
  }
  const data: WorkOrderListData = {
    workOrders: workOrders,
    page: page,
    pageSize: pageSize,
    total: total
  };
  return data;
}

function normalizeWorkOrderResources(response: WorkOrderResourcesResponse): WorkOrderResourcesData {
  const payload = response.data;
  let categories: ResourceCategory[] = [];
  let files: ResourceFile[] = [];
  let recognized = false;

  if (payload) {
    if (Array.isArray(payload)) {
      files = payload;
      recognized = true;
    } else if (payload.categories) {
      categories = payload.categories;
      recognized = true;
    } else if (payload.resourceCategories) {
      categories = payload.resourceCategories;
      recognized = true;
    }
    if (payload.files) {
      files = payload.files;
      recognized = true;
    } else if (payload.resourceFiles) {
      files = payload.resourceFiles;
      recognized = true;
    }
  } else {
    if (response.categories) {
      categories = response.categories;
      recognized = true;
    }
    if (response.files) {
      files = response.files;
      recognized = true;
    }
  }

  if (!recognized) {
    throw new ApiException('资料接口返回格式异常');
  }

  const data: WorkOrderResourcesData = {
    categories: categories,
    files: files
  };
  return data;
}
