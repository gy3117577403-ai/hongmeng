import type common from '@ohos.app.ability.common';
import type { ResourceFile } from '../models/ResourceFile';
import { ToastAdapter } from './ToastAdapter';

export class DownloadAdapter {
  static async downloadFile(file: ResourceFile, url: string, context?: common.UIAbilityContext): Promise<void> {
    await DownloadAdapter.openUrl(url, context, `已打开下载：${file.displayName || file.originalName}`);
  }

  static async openFile(file: ResourceFile, url: string, context?: common.UIAbilityContext): Promise<void> {
    await DownloadAdapter.openUrl(url, context, `已打开文件：${file.displayName || file.originalName}`);
  }

  static async downloadPackage(name: string, url: string, context?: common.UIAbilityContext): Promise<void> {
    await DownloadAdapter.openUrl(url, context, `已打开下载：${name}`);
  }

  static async openUrl(url: string, context: common.UIAbilityContext | undefined, successText: string): Promise<void> {
    if (!context) {
      ToastAdapter.show(`${successText}。如未自动打开，请复制链接到浏览器。`);
      return;
    }
    try {
      await context.startAbility({
        action: 'ohos.want.action.viewData',
        uri: url
      });
      ToastAdapter.success(successText);
    } catch (_) {
      ToastAdapter.error('系统无法打开下载链接，请检查是否有可用浏览器或下载应用。');
    }
  }
}
