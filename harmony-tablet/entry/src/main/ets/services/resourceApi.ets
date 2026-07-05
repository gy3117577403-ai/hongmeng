import { httpClient, NativeApiBaseResponse, MultipartUploadInput } from './httpClient';
import type { ResourceFile } from '../models/ResourceFile';
import type { PickedFile } from '../platform/FilePickerAdapter';

export interface ResourceFileData {
  file: ResourceFile;
}

export interface ResourceFileResponse extends NativeApiBaseResponse {
  data: ResourceFileData;
}

export interface ResourceDeleteData {
  deleted: boolean;
  file: ResourceFile;
}

export interface ResourceDeleteResponse extends NativeApiBaseResponse {
  data: ResourceDeleteData;
}

export interface ConfirmDeleteRequest {
  confirmText: string;
}

export interface ResourceFileUpdateRequest {
  displayName?: string;
  remark?: string;
  workOrderId?: string;
  categoryId?: string;
}

export function nativeContentUrl(file: ResourceFile): string {
  return httpClient.contentUrl(file.contentUrl);
}

export function nativeDownloadUrl(file: ResourceFile): string {
  return httpClient.contentUrl(file.downloadUrl);
}

export async function uploadResourceFile(workOrderId: string, categoryId: string, file: PickedFile): Promise<ResourceFileData> {
  const input: MultipartUploadInput = {
    workOrderId: workOrderId,
    categoryId: categoryId,
    fileFieldName: 'file',
    file: file
  };
  const response = await httpClient.uploadMultipart('/api/native/resource-files/upload', input);
  const parsed = JSON.parse(response.text) as ResourceFileResponse;
  return parsed.data;
}

export async function deleteResourceFile(id: string): Promise<ResourceDeleteData> {
  const body: ConfirmDeleteRequest = {
    confirmText: 'DELETE'
  };
  const response = await httpClient.delete(`/api/native/resource-files/${id}`, JSON.stringify(body));
  const parsed = JSON.parse(response.text) as ResourceDeleteResponse;
  return parsed.data;
}

export async function updateResourceFile(id: string, body: ResourceFileUpdateRequest): Promise<ResourceFileData> {
  const response = await httpClient.patch(`/api/native/resource-files/${id}`, JSON.stringify(body));
  const parsed = JSON.parse(response.text) as ResourceFileResponse;
  return parsed.data;
}

export async function restoreResourceFile(id: string): Promise<ResourceFileData> {
  const response = await httpClient.post(`/api/native/resource-files/${id}/restore`);
  const parsed = JSON.parse(response.text) as ResourceFileResponse;
  return parsed.data;
}
