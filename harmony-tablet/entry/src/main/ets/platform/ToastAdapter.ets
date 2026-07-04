import promptAction from '@ohos.promptAction';

export class ToastAdapter {
  static show(message: string): void {
    promptAction.showToast({ message });
  }

  static success(message: string): void {
    ToastAdapter.show(message);
  }

  static error(message: string): void {
    ToastAdapter.show(message);
  }
}
