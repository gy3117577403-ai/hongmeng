import type { PickedFile } from './FilePickerAdapter';
import { FilePickerAdapter } from './FilePickerAdapter';

export class CameraAdapter {
  static lastPhoto?: PickedFile;

  static isSupported(): boolean {
    return true;
  }

  static supportsDirectCapture(): boolean {
    return false;
  }

  static statusText(): string {
    if (CameraAdapter.supportsDirectCapture()) {
      return '可用';
    }
    return CameraAdapter.isSupported() ? '上传图片兜底' : '请使用上传图片';
  }

  static guidanceText(): string {
    if (CameraAdapter.supportsDirectCapture()) {
      return '将打开系统相机，拍照后请确认上传到当前工单和当前分类。';
    }
    return '当前设备暂不支持直接拍照，请先用系统相机拍照后选择图片，或使用上传图片。';
  }

  static actionText(): string {
    return CameraAdapter.supportsDirectCapture() ? '拍照' : '选择现场照片';
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
