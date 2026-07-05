import pasteboard from '@ohos.pasteboard';
import { ToastAdapter } from './ToastAdapter';

export class ClipboardAdapter {
  static async copyText(text: string, label: string): Promise<boolean> {
    try {
      const data = pasteboard.createPlainTextData(text);
      const board = pasteboard.getSystemPasteboard();
      await board.setData(data);
      ToastAdapter.success(`${label}已复制`);
      return true;
    } catch (_) {
      ToastAdapter.error('系统剪贴板不可用，请手动记录当前链接。');
      return false;
    }
  }
}
