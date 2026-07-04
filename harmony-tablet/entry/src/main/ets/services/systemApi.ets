import { httpClient, NativeApiBaseResponse } from './httpClient';

export interface SystemAppStatus {
  name: string;
  version: string;
  mode: string;
  uptime: number;
}

export interface SystemDataStatus {
  mode: string;
  permissions: string;
}

export interface SystemDatabaseStatus {
  ok: boolean;
  type: string;
  latencyMs: number;
}

export interface SystemStorageStatus {
  ok: boolean;
  type: string;
  bucketConfigured: boolean;
  publicEndpointConfigured: boolean;
  latencyMs: number;
}

export interface SystemUploadStatus {
  maxUploadSizeMb: number;
  supportedTypes: string[];
}

export interface SystemCounts {
  workOrders: number;
  resourceFiles: number;
  connectorParameters: number;
  operationLogsRecent: number;
  failedUploads: number;
}

export interface NativeSystemStatus {
  ok: boolean;
  app: SystemAppStatus;
  data: SystemDataStatus;
  database: SystemDatabaseStatus;
  storage: SystemStorageStatus;
  upload: SystemUploadStatus;
  counts: SystemCounts;
  warnings: string[];
  serverTime: string;
}

export interface SystemStatusResponse extends NativeApiBaseResponse {
  data: NativeSystemStatus;
}

export async function fetchSystemStatus(): Promise<NativeSystemStatus> {
  const response = await httpClient.get('/api/native/system/status');
  const parsed = JSON.parse(response.text) as SystemStatusResponse;
  return parsed.data;
}
