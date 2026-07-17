import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFileContent, validateFileSignature } from '../lib/validation';

test('accepts supported files when extension, MIME and signature agree', () => {
  assert.equal(validateFileContent('drawing.pdf', 'application/pdf', 8, Buffer.from('%PDF-1.7')), null);
  assert.equal(validateFileContent('photo.jpg', 'image/jpeg', 4, Buffer.from([0xff, 0xd8, 0xff, 0xd9])), null);
  assert.equal(validateFileContent('scan.png', 'image/png', 8, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), null);
  assert.equal(validateFileContent('image.webp', 'image/webp', 12, Buffer.from('RIFF0000WEBP')), null);
});

test('rejects renamed or truncated content before object storage upload', () => {
  assert.equal(validateFileContent('renamed.pdf', 'application/pdf', 9, Buffer.from('<html>bad')), 'PDF 文件头无效');
  assert.equal(validateFileSignature('jpg', Buffer.from('not-jpeg')), 'JPEG 文件头无效');
  assert.equal(validateFileSignature('png', Buffer.from([0x89, 0x50])), 'PNG 文件头无效');
  assert.equal(validateFileSignature('webp', Buffer.from('RIFFshort')), 'WEBP 文件头无效');
});

test('keeps generic extension, MIME, empty-file and size validation', () => {
  assert.equal(validateFileContent('drawing.exe', 'application/octet-stream', 4, Buffer.from('MZ00')), '仅支持 PDF、JPG、JPEG、PNG、WEBP 文件');
  assert.equal(validateFileContent('empty.pdf', 'application/pdf', 0, Buffer.alloc(0)), '文件为空');
  assert.equal(validateFileContent('drawing.pdf', 'text/plain', 8, Buffer.from('%PDF-1.7')), '文件 MIME 类型不支持');
});
