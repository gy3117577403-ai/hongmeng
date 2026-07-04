export class PermissionAdapter {
  static async ensureCamera(): Promise<boolean> {
    // TODO(DevEco): request ohos.permission.CAMERA in a real device context.
    return false;
  }

  static async ensureMediaRead(): Promise<boolean> {
    // TODO(DevEco): request media read permission if picker requires it.
    return true;
  }
}
