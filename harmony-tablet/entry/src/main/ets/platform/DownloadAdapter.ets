import type common from '@ohos.app.ability.common';
import type { ResourceFile } from '../models/ResourceFile';
import { httpClient } from '../services/httpClient';
import { ClipboardAdapter } from './ClipboardAdapter';
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
    let resolvedUrl = url;
    try {
      resolvedUrl = await httpClient.resolveDownloadUrl(url);
    } catch (_) {
      ToastAdapter.error('下载链接生成失败，请检查登录状态和网络连接。');
      return;
    }
    if (!context) {
      await ClipboardAdapter.copyText(resolvedUrl, '下载链接');
      return;
    }
    try {
      await context.startAbility({
        action: 'ohos.want.action.viewData',
        uri: resolvedUrl
      });
      ToastAdapter.success(successText);
    } catch (_) {
      const copied = await ClipboardAdapter.copyText(resolvedUrl, '下载链接');
      if (!copied) {
        ToastAdapter.error('系统无法打开下载链接，请检查是否有可用浏览器或下载应用。');
      }
    }
  }
}
