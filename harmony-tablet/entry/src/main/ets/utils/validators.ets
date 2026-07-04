export function notBlank(value: string): boolean {
  return value.trim().length > 0;
}

export function isImageType(fileType?: string, mimeType?: string): boolean {
  const raw = `${fileType || ''} ${mimeType || ''}`.toLowerCase();
  return raw.includes('jpg') || raw.includes('jpeg') || raw.includes('png') || raw.includes('image');
}

export function isPdfType(fileType?: string, mimeType?: string): boolean {
  const raw = `${fileType || ''} ${mimeType || ''}`.toLowerCase();
  return raw.includes('pdf');
}
