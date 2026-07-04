import { httpClient } from './httpClient';
import type { ConnectorParameter } from '../models/ConnectorParameter';

export interface ConnectorListData {
  parameters: ConnectorParameter[];
  page: number;
  pageSize: number;
  total: number;
}

export async function fetchConnectorParameters(keyword: string = '', page: number = 1): Promise<ConnectorListData> {
  return httpClient.get<ConnectorListData>(`/api/native/connector-parameters?page=${page}&pageSize=80&keyword=${encodeURIComponent(keyword)}`);
}

export async function saveConnectorParameter(body: object): Promise<{ parameter: ConnectorParameter }> {
  return httpClient.post<{ parameter: ConnectorParameter }>('/api/native/connector-parameters', body);
}

export async function updateConnectorParameter(id: string, body: object): Promise<{ parameter: ConnectorParameter }> {
  return httpClient.patch<{ parameter: ConnectorParameter }>(`/api/native/connector-parameters/${id}`, body);
}
