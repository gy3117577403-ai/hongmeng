import type { PickedFile } from './FilePickerAdapter';

export class CameraAdapter {
  static isSupported(): boolean {
    return false;
  }

  static statusText(): string {
    return CameraAdapter.isSupported() ? '可用' : '请使用上传图片';
  }

  static guidanceText(): string {
    return '当前设备暂不支持直接拍照，请使用上传图片或 Web 端上传。';
  }

  static async openCamera(): Promise<void> {
  }

  static async takePhoto(): Promise<PickedFile | undefined> {
    return undefined;
  }

  static async release(): Promise<void> {
  }
}
