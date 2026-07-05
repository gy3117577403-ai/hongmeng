import type { PickedFile } from './FilePickerAdapter';
import { FilePickerAdapter } from './FilePickerAdapter';

export class CameraAdapter {
  static lastPhoto?: PickedFile;

  static isSupported(): boolean {
    return true;
  }

  static statusText(): string {
    return CameraAdapter.isSupported() ? '可用' : '请使用上传图片';
  }

  static guidanceText(): string {
    return '将打开系统图片选择器；如设备未提供相机入口，请先拍照后选择图片上传。';
  }

  static async openCamera(): Promise<void> {
    CameraAdapter.lastPhoto = undefined;
    const files = await FilePickerAdapter.pickImages();
    if (files.length > 0) {
      CameraAdapter.lastPhoto = files[0];
    }
  }

  static async takePhoto(): Promise<PickedFile | undefined> {
    return CameraAdapter.lastPhoto;
  }

  static async release(): Promise<void> {
    CameraAdapter.lastPhoto = undefined;
  }
}
