import { httpClient } from './httpClient';
import type { ResourceFile } from '../models/ResourceFile';

export function nativeContentUrl(file: ResourceFile): string {
  return httpClient.contentUrl(file.contentUrl);
}

export function nativeDownloadUrl(file: ResourceFile): string {
  return httpClient.contentUrl(file.downloadUrl);
}

export async function uploadPlaceholder(): Promise<void> {
  throw new Error('文件选择、相机拍照上传需要在 DevEco 真机环境继续接入 picker 与 cameraPicker');
}
