import { httpClient } from './httpClient';
import type { ResourceFile } from '../models/ResourceFile';
import type { PickedFile } from '../platform/FilePickerAdapter';

export function nativeContentUrl(file: ResourceFile): string {
  return httpClient.contentUrl(file.contentUrl);
}

export function nativeDownloadUrl(file: ResourceFile): string {
  return httpClient.contentUrl(file.downloadUrl);
}

export async function uploadResourceFile(workOrderId: string, categoryId: string, file: PickedFile): Promise<{ file: ResourceFile }> {
  return httpClient.uploadMultipart<{ file: ResourceFile }>('/api/native/resource-files/upload', {
    fields: { workOrderId, categoryId },
    fileFieldName: 'file',
    file
  });
}

export async function deleteResourceFile(id: string): Promise<{ deleted: boolean; file: ResourceFile }> {
  return httpClient.delete<{ deleted: boolean; file: ResourceFile }>(`/api/native/resource-files/${id}`, { confirmText: 'DELETE' });
}
