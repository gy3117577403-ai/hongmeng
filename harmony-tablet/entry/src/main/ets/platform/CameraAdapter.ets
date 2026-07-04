import type { PickedFile } from './FilePickerAdapter';

export class CameraAdapter {
  static isSupported(): boolean {
    // TODO(DevEco): detect camera availability with the real device camera API.
    return false;
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
