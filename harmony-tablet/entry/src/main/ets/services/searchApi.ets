import type { ResourceFile } from '../models/ResourceFile';
import type { WorkOrder } from '../models/WorkOrder';
import { httpClient, NativeApiBaseResponse } from './httpClient';

export interface NativeSearchData {
  workOrders: WorkOrder[];
  resourceFiles: ResourceFile[];
}

export interface NativeSearchResponse extends NativeApiBaseResponse {
  data: NativeSearchData;
}

export async function searchNative(keyword: string): Promise<NativeSearchData> {
  const q = encodeURIComponent(keyword);
  const response = await httpClient.get(`/api/native/search?keyword=${q}`);
  const parsed = JSON.parse(response.text) as NativeSearchResponse;
  return parsed.data;
}
