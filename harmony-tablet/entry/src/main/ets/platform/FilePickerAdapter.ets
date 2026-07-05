export interface PickedFile {
  name: string;
  mimeType: string;
  size: number;
  uri?: string;
  data?: ArrayBuffer;
}

export class FilePickerAdapter {
  static isSupported(): boolean {
    return false;
  }

  static statusText(): string {
    return FilePickerAdapter.isSupported() ? '可用' : '请使用 Web 端';
  }

  static guidanceText(): string {
    return '当前设备暂不支持原生文件选择，请使用 Web 端上传。';
  }

  static async pickPdf(): Promise<PickedFile[]> {
    return [];
  }

  static async pickImages(): Promise<PickedFile[]> {
    return [];
  }

  static async pickAnySupportedFile(): Promise<PickedFile[]> {
    return [];
  }
}
