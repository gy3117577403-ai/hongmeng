import picker from '@ohos.file.picker';

export interface PickedFile {
  name: string;
  mimeType: string;
  size: number;
  uri?: string;
  data?: ArrayBuffer;
}

export interface PickedFileSource {
  uri: string;
  mimeType: string;
  fallbackName: string;
}

export class FilePickerAdapter {
  static isSupported(): boolean {
    return true;
  }

  static statusText(): string {
    return FilePickerAdapter.isSupported() ? '可用' : '请使用 Web 端';
  }

  static guidanceText(): string {
    return '请选择 PDF、图片或 CSV/XLSX 文件；如系统选择器不可用，可使用 Web 端上传。';
  }

  static async pickPdf(): Promise<PickedFile[]> {
    try {
      const options = new picker.DocumentSelectOptions();
      options.maxSelectNumber = 6;
      options.fileSuffixFilters = ['.pdf'];
      const documentPicker = new picker.DocumentViewPicker();
      const uris: string[] = await documentPicker.select(options);
      return FilePickerAdapter.filesFromUris(uris, 'application/pdf', 'work-order.pdf');
    } catch (err) {
      throw new Error(FilePickerAdapter.selectionErrorText(err as Error));
    }
  }

  static async pickImages(): Promise<PickedFile[]> {
    try {
      const options = new picker.PhotoSelectOptions();
      options.MIMEType = picker.PhotoViewMIMETypes.IMAGE_TYPE;
      options.maxSelectNumber = 12;
      const photoPicker = new picker.PhotoViewPicker();
      const result = await photoPicker.select(options);
      return FilePickerAdapter.filesFromUris(result.photoUris, 'image/jpeg', 'work-order-image.jpg');
    } catch (err) {
      throw new Error(FilePickerAdapter.selectionErrorText(err as Error));
    }
  }

  static async pickAnySupportedFile(): Promise<PickedFile[]> {
    try {
      const options = new picker.DocumentSelectOptions();
      options.maxSelectNumber = 12;
      options.fileSuffixFilters = ['.csv', '.xlsx', '.xls', '.pdf', '.jpg', '.jpeg', '.png'];
      const documentPicker = new picker.DocumentViewPicker();
      const uris: string[] = await documentPicker.select(options);
      return FilePickerAdapter.filesFromUris(uris, 'application/octet-stream', 'connector-attachment');
    } catch (err) {
      throw new Error(FilePickerAdapter.selectionErrorText(err as Error));
    }
  }

  static fileFromUri(source: PickedFileSource): PickedFile {
    const name = FilePickerAdapter.nameFromUri(source.uri, source.fallbackName);
    const file: PickedFile = {
      name: name,
      mimeType: FilePickerAdapter.mimeFromName(name, source.mimeType),
      size: 0,
      uri: source.uri
    };
    return file;
  }

  static filesFromUris(uris: string[], mimeType: string, fallbackName: string): PickedFile[] {
    const files: PickedFile[] = [];
    for (let i = 0; i < uris.length; i++) {
      const source: PickedFileSource = {
        uri: uris[i],
        mimeType: mimeType,
        fallbackName: fallbackName
      };
      files.push(FilePickerAdapter.fileFromUri(source));
    }
    return files;
  }

  static nameFromUri(uri: string, fallbackName: string): string {
    const queryIndex = uri.indexOf('?');
    const clean = queryIndex >= 0 ? uri.substring(0, queryIndex) : uri;
    const slashIndex = clean.lastIndexOf('/');
    const rawName = slashIndex >= 0 ? clean.substring(slashIndex + 1) : clean;
    if (rawName.length === 0) return fallbackName;
    try {
      return decodeURIComponent(rawName);
    } catch (_) {
      return rawName;
    }
  }

  static mimeFromName(name: string, fallbackMime: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.csv')) return 'text/csv';
    if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
    return fallbackMime;
  }

  static selectionErrorText(err: Error): string {
    const message = err.message || '';
    if (message.indexOf('cancel') >= 0 || message.indexOf('Cancel') >= 0 || message.indexOf('用户取消') >= 0) {
      return '已取消选择';
    }
    if (message.indexOf('permission') >= 0 || message.indexOf('Permission') >= 0 || message.indexOf('权限') >= 0) {
      return '请授予文件访问权限后重试';
    }
    return '系统文件选择器不可用，请稍后重试或使用 Web 端上传。';
  }
}
