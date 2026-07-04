import type { ResourceFile } from '../models/ResourceFile';
import { ToastAdapter } from './ToastAdapter';

export class DownloadAdapter {
  static async downloadFile(file: ResourceFile, url: string): Promise<void> {
    // TODO(DevEco): use request.downloadFile or file picker save flow with Authorization header.
    ToastAdapter.show(`已准备下载：${file.displayName || file.originalName}`);
  }

  static async openFile(file: ResourceFile, url: string): Promise<void> {
    // TODO(DevEco): download to cache and open with system file viewer.
    ToastAdapter.show(`已准备打开：${file.displayName || file.originalName}`);
  }
}
