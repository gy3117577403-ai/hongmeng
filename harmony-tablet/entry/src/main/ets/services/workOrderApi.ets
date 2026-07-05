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
  items?: ResourceFile[];
}

export interface WorkOrderResourcesResponse extends NativeApiBaseResponse {
  data?: WorkOrderResourcesPayload;
  categories?: ResourceCategory[];
  files?: ResourceFile[];
  resourceCategories?: ResourceCategory[];
  resourceFiles?: ResourceFile[];
  items?: ResourceFile[];
}

export interface WorkOrderResourcesArrayResponse extends NativeApiBaseResponse {
  data?: ResourceFile[];
}

export class NativeWorkOrderResourcesResult {
  categories: ResourceCategory[] = [];
  files: ResourceFile[] = [];
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
  await httpClient.requestDelete(`/api/native/work-orders/${id}`, JSON.stringify(body));
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
  const parsedText = response.text;
  const parsed = JSON.parse(parsedText) as WorkOrderResourcesResponse;
  const arrayParsed = JSON.parse(parsedText) as WorkOrderResourcesArrayResponse;
  return normalizeWorkOrderResources(parsed, arrayParsed);
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

function normalizeResourcesFromPayload(body: WorkOrderResourcesPayload): NativeWorkOrderResourcesResult {
  const result: NativeWorkOrderResourcesResult = new NativeWorkOrderResourcesResult();

  if (body.categories !== undefined) {
    result.categories = body.categories;
  } else if (body.resourceCategories !== undefined) {
    result.categories = body.resourceCategories;
  }

  if (body.files !== undefined) {
    result.files = body.files;
  } else if (body.resourceFiles !== undefined) {
    result.files = body.resourceFiles;
  } else if (body.items !== undefined) {
    result.files = body.items;
  }

  return result;
}

function hasResourcePayloadFields(body: WorkOrderResourcesPayload): boolean {
  if (body.categories !== undefined) return true;
  if (body.resourceCategories !== undefined) return true;
  if (body.files !== undefined) return true;
  if (body.resourceFiles !== undefined) return true;
  if (body.items !== undefined) return true;
  return false;
}

function normalizeWorkOrderResources(response: WorkOrderResourcesResponse, arrayResponse: WorkOrderResourcesArrayResponse): WorkOrderResourcesData {
  const result: NativeWorkOrderResourcesResult = new NativeWorkOrderResourcesResult();
  let recognized = false;
  const arrayData = arrayResponse.data;

  if (arrayData !== undefined && Array.isArray(arrayData)) {
    result.files = arrayData;
    recognized = true;
  } else {
    const objectData = response.data;
    if (objectData !== undefined && hasResourcePayloadFields(objectData)) {
      const normalized = normalizeResourcesFromPayload(objectData);
      result.categories = normalized.categories;
      result.files = normalized.files;
      recognized = true;
    }
  }

  if (response.categories !== undefined) {
    result.categories = response.categories;
    recognized = true;
  } else if (response.resourceCategories !== undefined) {
    result.categories = response.resourceCategories;
    recognized = true;
  }

  if (response.files !== undefined) {
    result.files = response.files;
    recognized = true;
  } else if (response.resourceFiles !== undefined) {
    result.files = response.resourceFiles;
    recognized = true;
  } else if (response.items !== undefined) {
    result.files = response.items;
    recognized = true;
  }

  if (!recognized) {
    throw new ApiException('资料接口返回格式异常');
  }

  const data: WorkOrderResourcesData = {
    categories: result.categories,
    files: result.files
  };
  return data;
}
