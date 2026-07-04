import { httpClient } from './httpClient';

export interface NativeSystemStatus {
  ok: boolean;
  app: {
    name: string;
    version: string;
    mode: string;
    uptime: number;
  };
  data: {
    mode: string;
    permissions: string;
  };
  database: {
    ok: boolean;
    type: string;
    latencyMs: number;
  };
  storage: {
    ok: boolean;
    type: string;
    bucketConfigured: boolean;
    publicEndpointConfigured: boolean;
    latencyMs: number;
  };
  upload: {
    maxUploadSizeMb: number;
    supportedTypes: string[];
  };
  counts: Record<string, number>;
  warnings: string[];
  serverTime: string;
}

export async function fetchSystemStatus(): Promise<NativeSystemStatus> {
  return httpClient.get<NativeSystemStatus>('/api/native/system/status');
}
