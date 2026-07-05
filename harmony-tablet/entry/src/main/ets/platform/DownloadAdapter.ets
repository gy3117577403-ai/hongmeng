import type { ResourceFile } from '../models/ResourceFile';
import { ToastAdapter } from './ToastAdapter';

export class DownloadAdapter {
  static async downloadFile(file: ResourceFile, url: string): Promise<void> {
    ToastAdapter.show(`已准备下载：${file.displayName || file.originalName}`);
  }

  static async openFile(file: ResourceFile, url: string): Promise<void> {
    ToastAdapter.show(`已准备打开：${file.displayName || file.originalName}`);
  }

  static async downloadPackage(name: string, url: string): Promise<void> {
    ToastAdapter.show(`已准备下载资料包：${name}`);
  }
}
