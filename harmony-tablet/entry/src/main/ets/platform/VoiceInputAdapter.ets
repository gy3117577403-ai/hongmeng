import { ToastAdapter } from './ToastAdapter';

export class VoiceInputAdapter {
  static isSupported(): boolean {
    return false;
  }

  static statusText(): string {
    return VoiceInputAdapter.isSupported() ? '可用' : '手动输入';
  }

  static buttonText(actionName: string = ''): string {
    if (VoiceInputAdapter.isSupported()) {
      return actionName.length > 0 ? `语音${actionName}` : '语音输入';
    }
    return actionName.length > 0 ? `手动${actionName}` : '手动输入';
  }

  static async startDictation(targetName: string): Promise<string> {
    ToastAdapter.show(`${targetName} 当前设备未开启语音能力，请使用键盘手动输入。`);
    return '';
  }
}
