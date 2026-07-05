export class PermissionAdapter {
  static async ensureCamera(): Promise<boolean> {
    return false;
  }

  static async ensureMediaRead(): Promise<boolean> {
    return true;
  }
}
