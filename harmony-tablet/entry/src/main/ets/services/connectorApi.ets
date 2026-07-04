import { httpClient, NativeApiBaseResponse } from './httpClient';
import type { ConnectorParameter } from '../models/ConnectorParameter';

export interface ConnectorListData {
  parameters: ConnectorParameter[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ConnectorListResponse extends NativeApiBaseResponse {
  data: ConnectorListData;
}

export interface ConnectorParameterData {
  parameter: ConnectorParameter;
}

export interface ConnectorParameterResponse extends NativeApiBaseResponse {
  data: ConnectorParameterData;
}

export interface ConnectorDeleteData {
  deleted: boolean;
}

export interface ConnectorDeleteResponse extends NativeApiBaseResponse {
  data: ConnectorDeleteData;
}

export interface ConnectorQuery {
  keyword: string;
  page: number;
  missing: string;
  highlighted: boolean;
}

export interface ConnectorParameterRequest {
  rowNo: string;
  model: string;
  outerPeelMm: string;
  innerPeelMm: string;
  insertionLengthMm: string;
  remark: string;
  isHighlighted: boolean;
}

export interface ConfirmDeleteRequest {
  confirmText: string;
}

export function emptyConnectorQuery(): ConnectorQuery {
  const query: ConnectorQuery = {
    keyword: '',
    page: 1,
    missing: '',
    highlighted: false
  };
  return query;
}

export async function fetchConnectorParameters(query: ConnectorQuery): Promise<ConnectorListData> {
  const params: string[] = [
    `page=${query.page}`,
    'pageSize=80',
    `keyword=${encodeURIComponent(query.keyword)}`
  ];
  if (query.missing.length > 0) params.push(`missing=${encodeURIComponent(query.missing)}`);
  if (query.highlighted) params.push('highlighted=true');
  const response = await httpClient.get(`/api/native/connector-parameters?${params.join('&')}`);
  const parsed = JSON.parse(response.text) as ConnectorListResponse;
  return parsed.data;
}

export async function saveConnectorParameter(body: ConnectorParameterRequest): Promise<ConnectorParameterData> {
  const response = await httpClient.post('/api/native/connector-parameters', JSON.stringify(body));
  const parsed = JSON.parse(response.text) as ConnectorParameterResponse;
  return parsed.data;
}

export async function updateConnectorParameter(id: string, body: ConnectorParameterRequest): Promise<ConnectorParameterData> {
  const response = await httpClient.patch(`/api/native/connector-parameters/${id}`, JSON.stringify(body));
  const parsed = JSON.parse(response.text) as ConnectorParameterResponse;
  return parsed.data;
}

export async function deleteConnectorParameter(id: string): Promise<ConnectorDeleteData> {
  const body: ConfirmDeleteRequest = {
    confirmText: 'DELETE'
  };
  const response = await httpClient.delete(`/api/native/connector-parameters/${id}`, JSON.stringify(body));
  const parsed = JSON.parse(response.text) as ConnectorDeleteResponse;
  return parsed.data;
}
