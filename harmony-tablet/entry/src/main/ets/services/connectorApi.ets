import { httpClient } from './httpClient';
import type { ConnectorParameter } from '../models/ConnectorParameter';

export interface ConnectorListData {
  parameters: ConnectorParameter[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ConnectorQuery {
  keyword?: string;
  page?: number;
  missing?: string;
  highlighted?: boolean;
}

export async function fetchConnectorParameters(query: ConnectorQuery = {}): Promise<ConnectorListData> {
  const params = [
    `page=${query.page || 1}`,
    'pageSize=80',
    `keyword=${encodeURIComponent(query.keyword || '')}`
  ];
  if (query.missing) params.push(`missing=${encodeURIComponent(query.missing)}`);
  if (query.highlighted) params.push('highlighted=true');
  return httpClient.get<ConnectorListData>(`/api/native/connector-parameters?${params.join('&')}`);
}

export async function saveConnectorParameter(body: object): Promise<{ parameter: ConnectorParameter }> {
  return httpClient.post<{ parameter: ConnectorParameter }>('/api/native/connector-parameters', body);
}

export async function updateConnectorParameter(id: string, body: object): Promise<{ parameter: ConnectorParameter }> {
  return httpClient.patch<{ parameter: ConnectorParameter }>(`/api/native/connector-parameters/${id}`, body);
}

export async function deleteConnectorParameter(id: string): Promise<{ deleted: boolean }> {
  return httpClient.delete<{ deleted: boolean }>(`/api/native/connector-parameters/${id}`, { confirmText: 'DELETE' });
}
