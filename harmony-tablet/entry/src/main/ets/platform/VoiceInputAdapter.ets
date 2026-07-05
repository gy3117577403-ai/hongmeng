import { ToastAdapter } from './ToastAdapter';

export class VoiceInputAdapter {
  static isSupported(): boolean {
    return false;
  }

  static statusText(): string {
    return VoiceInputAdapter.isSupported() ? '可用' : '手动输入';
  }

  static async startDictation(targetName: string): Promise<string> {
    ToastAdapter.show(`${targetName} 暂不支持语音输入，请使用键盘手动输入。`);
    return '';
  }
}
