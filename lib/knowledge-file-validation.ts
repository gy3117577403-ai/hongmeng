import { CFB } from 'xlsx';
import { ext, fileType, maxBytes, validateFileContent } from '@/lib/validation';

const officeMime: Record<string, string> = {
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// Inspect the ZIP directory without inflating document contents just to accept an upload.
function officeZipPaths(body: Uint8Array): string[] {
  const bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (bytes.readUInt32LE(end) === 0x06054b50 && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length) break;
  }
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) throw new Error('Missing ZIP directory');
  const count = bytes.readUInt16LE(end + 10), length = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || count !== bytes.readUInt16LE(end + 8) || count > 10000 || start + length !== end) throw new Error('Unsupported ZIP directory');
  const paths: string[] = [];
  let position = start;
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || bytes.readUInt32LE(position) !== 0x02014b50 || (bytes.readUInt16LE(position + 8) & 1)) throw new Error('Invalid ZIP entry');
    const nameLength = bytes.readUInt16LE(position + 28), extraLength = bytes.readUInt16LE(position + 30), commentLength = bytes.readUInt16LE(position + 32);
    const offset = bytes.readUInt32LE(position + 42);
    if (position + 46 + nameLength + extraLength + commentLength > end || offset + 30 > start || bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error('Invalid ZIP bounds');
    paths.push(bytes.toString('utf8', position + 46, position + 46 + nameLength));
    position += 46 + nameLength + extraLength + commentLength;
  }
  if (position !== end) throw new Error('Incomplete ZIP directory');
  return paths;
}

export function knowledgeFileInfo(name: string, mime: string) {
  const extension = ext(name);
  return officeMime[extension]
    ? { fileType: extension, mimeType: officeMime[extension] }
    : { fileType: fileType(name, mime), mimeType: mime || ({ pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', unknown: 'application/octet-stream' }[fileType(name, mime)]) };
}

// This allowlist is deliberately local to knowledge; drawing uploads keep their rules.
export function validateKnowledgeFile(name: string, mime: string, size: number, body: Uint8Array): string | null {
  const extension = ext(name);
  if (!officeMime[extension]) return validateFileContent(name, mime, size, body);
  if (size <= 0 || size !== body.byteLength) return '文件为空或上传不完整';
  if (size > maxBytes()) return `单文件不能超过 ${maxBytes() / 1024 / 1024} MB`;
  const legacy = extension === 'xls' || extension === 'doc';
  const signature = legacy ? [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] : [0x50, 0x4b, 0x03, 0x04];
  if (!signature.every((value, index) => body[index] === value)) return '文件内容与 Excel / Word 扩展名不一致';
  try {
    const paths: string[] = legacy
      ? CFB.read(Buffer.from(body), { type: 'buffer' }).FullPaths.map((path: string) => path.replace(/^[^/]+\//, ''))
      : officeZipPaths(body);
    const found = extension === 'xls' ? paths.some(path => /^(Workbook|Book)$/i.test(path))
      : extension === 'doc' ? paths.includes('WordDocument')
      : paths.includes('[Content_Types].xml') && paths.includes(extension === 'xlsx' ? 'xl/workbook.xml' : 'word/document.xml');
    return found ? null : '未找到有效的 Excel / Word 文档结构，请核对文件格式';
  } catch {
    return 'Excel / Word 文件已损坏或加密，请使用可正常打开的文件';
  }
}
