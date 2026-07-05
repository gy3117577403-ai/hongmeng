import { httpClient, NativeApiBaseResponse, MultipartUploadInput } from './httpClient';
import type { ConnectorParameter } from '../models/ConnectorParameter';
import type { PickedFile } from '../platform/FilePickerAdapter';

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

export interface ConnectorBatchData {
  count: number;
}

export interface ConnectorBatchResponse extends NativeApiBaseResponse {
  data: ConnectorBatchData;
}

export interface ConnectorImportPreviewSummary {
  totalRows: number;
  readyCount: number;
  duplicateCount: number;
  invalidCount: number;
  skippedCount: number;
  highlightedCount: number;
}

export interface ConnectorImportPreviewRow {
  index: number;
  rowNo?: string;
  model?: string;
  outerPeelMm?: string;
  innerPeelMm?: string;
  insertionLengthMm?: string;
  remark?: string;
  isHighlighted: boolean;
  status: string;
  reason?: string;
}

export interface ConnectorImportPreviewData {
  rows: ConnectorImportPreviewRow[];
  summary: ConnectorImportPreviewSummary;
}

export interface ConnectorImportPreviewResponse extends NativeApiBaseResponse {
  data: ConnectorImportPreviewData;
}

export interface ConnectorImportCommitSummary {
  created: number;
  skipped: number;
  failed: number;
  duplicateSkipped: number;
  total: number;
}

export interface ConnectorImportCommitData {
  summary: ConnectorImportCommitSummary;
}

export interface ConnectorImportCommitResponse extends NativeApiBaseResponse {
  data: ConnectorImportCommitData;
}

export interface ConnectorAttachment {
  id: string;
  originalName: string;
  displayName?: string | null;
  mimeType: string;
  fileType: string;
  fileSize: number;
  uploadedBy?: string | null;
  createdAt: string;
  downloadUrl: string;
}

export interface ConnectorAttachmentListData {
  files: ConnectorAttachment[];
}

export interface ConnectorAttachmentListResponse extends NativeApiBaseResponse {
  data: ConnectorAttachmentListData;
}

export interface ConnectorAttachmentData {
  file: ConnectorAttachment;
}

export interface ConnectorAttachmentResponse extends NativeApiBaseResponse {
  data: ConnectorAttachmentData;
}

export interface ConnectorImportBatch {
  id: string;
  fileName?: string | null;
  totalRows: number;
  insertedCount: number;
  duplicateStrategy: string;
  createdAt: string;
  rolledBackAt?: string | null;
  activeParameterCount: number;
}

export interface ConnectorImportBatchListData {
  batches: ConnectorImportBatch[];
}

export interface ConnectorImportBatchListResponse extends NativeApiBaseResponse {
  data: ConnectorImportBatchListData;
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

export async function restoreConnectorParameter(id: string): Promise<ConnectorParameterData> {
  const response = await httpClient.post(`/api/native/connector-parameters/${id}/restore`);
  const parsed = JSON.parse(response.text) as ConnectorParameterResponse;
  return parsed.data;
}

export async function batchConnectorParameters(ids: string[], action: string): Promise<ConnectorBatchData> {
  const response = await httpClient.post('/api/native/connector-parameters/batch', JSON.stringify({
    ids: ids,
    action: action,
    confirmText: action === 'delete' ? 'DELETE' : ''
  }));
  const parsed = JSON.parse(response.text) as ConnectorBatchResponse;
  return parsed.data;
}

export async function previewConnectorImport(text: string): Promise<ConnectorImportPreviewData> {
  const response = await httpClient.post('/api/native/connector-parameters/import/preview', JSON.stringify({ text: text }));
  const parsed = JSON.parse(response.text) as ConnectorImportPreviewResponse;
  return parsed.data;
}

export async function previewConnectorImportFile(file: PickedFile): Promise<ConnectorImportPreviewData> {
  const input: MultipartUploadInput = {
    fileFieldName: 'file',
    file: file
  };
  const response = await httpClient.uploadMultipart('/api/native/connector-parameters/import/preview', input);
  const parsed = JSON.parse(response.text) as ConnectorImportPreviewResponse;
  return parsed.data;
}

export async function commitConnectorImport(rows: ConnectorImportPreviewRow[], importDuplicates: boolean): Promise<ConnectorImportCommitData> {
  const response = await httpClient.post('/api/native/connector-parameters/import/commit', JSON.stringify({
    rows: rows,
    duplicateStrategy: importDuplicates ? 'import' : 'skip',
    sourceType: 'harmony_native_text',
    fileName: 'native-paste.csv'
  }));
  const parsed = JSON.parse(response.text) as ConnectorImportCommitResponse;
  return parsed.data;
}

export async function fetchConnectorAttachments(): Promise<ConnectorAttachmentListData> {
  const response = await httpClient.get('/api/native/connector-parameter-files');
  const parsed = JSON.parse(response.text) as ConnectorAttachmentListResponse;
  return parsed.data;
}

export async function uploadConnectorAttachment(file: PickedFile): Promise<ConnectorAttachmentData> {
  const input: MultipartUploadInput = {
    fileFieldName: 'file',
    file: file
  };
  const response = await httpClient.uploadMultipart('/api/native/connector-parameter-files/upload', input);
  const parsed = JSON.parse(response.text) as ConnectorAttachmentResponse;
  return parsed.data;
}

export async function deleteConnectorAttachment(id: string): Promise<void> {
  const body: ConfirmDeleteRequest = { confirmText: 'DELETE' };
  await httpClient.delete(`/api/native/connector-parameter-files/${id}`, JSON.stringify(body));
}

export async function fetchImportBatches(): Promise<ConnectorImportBatchListData> {
  const response = await httpClient.get('/api/native/connector-parameter-import-batches?limit=20');
  const parsed = JSON.parse(response.text) as ConnectorImportBatchListResponse;
  return parsed.data;
}

export async function rollbackImportBatch(id: string): Promise<void> {
  await httpClient.post(`/api/native/connector-parameter-import-batches/${id}/rollback`);
}

export function connectorExportUrl(): string {
  return httpClient.contentUrl('/api/native/connector-parameters/export.csv');
}

export function connectorTemplateUrl(): string {
  return httpClient.contentUrl('/api/native/connector-parameters/template.csv');
}

export function connectorAttachmentDownloadUrl(file: ConnectorAttachment): string {
  return httpClient.contentUrl(file.downloadUrl);
}
