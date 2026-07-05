import type { PickedFile } from './FilePickerAdapter';

export class CameraAdapter {
  static isSupported(): boolean {
    // TODO(DevEco): detect camera availability with the real device camera API.
    return false;
  }

  static statusText(): string {
    return CameraAdapter.isSupported() ? '可用' : '待真机适配';
  }

  static guidanceText(): string {
    return '相机能力待真机适配，可先使用上传图片或 Web 端上传。';
  }

  static async openCamera(): Promise<void> {
    // TODO(DevEco): connect camera preview session on real Harmony tablet.
  }

  static async takePhoto(): Promise<PickedFile | undefined> {
    // TODO(DevEco): capture a JPG/PNG and return a PickedFile payload.
    return undefined;
  }

  static async release(): Promise<void> {
    // TODO(DevEco): release camera session resources.
  }
}
