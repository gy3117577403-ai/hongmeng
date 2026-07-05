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
    return FilePickerAdapter.isSupported() ? '可用' : '待真机适配';
  }

  static guidanceText(): string {
    return '文件选择能力正在适配，请使用 Web 端上传或等待下一版本。';
  }

  static async pickPdf(): Promise<PickedFile[]> {
    // TODO(DevEco): replace with document picker constrained to application/pdf.
    return [];
  }

  static async pickImages(): Promise<PickedFile[]> {
    // TODO(DevEco): replace with photo picker constrained to JPG/PNG images.
    return [];
  }

  static async pickAnySupportedFile(): Promise<PickedFile[]> {
    // TODO(DevEco): replace with picker for PDF/JPG/PNG.
    return [];
  }
}
