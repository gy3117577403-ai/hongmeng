export interface PickedFile {
  name: string;
  mimeType: string;
  size: number;
  uri?: string;
  data?: ArrayBuffer;
}

export class FilePickerAdapter {
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
