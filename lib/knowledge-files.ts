export const KNOWLEDGE_FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx';
export const KNOWLEDGE_FILE_HELP = '支持 Excel（xls、xlsx）、Word（doc、docx）、PDF 和图片。保存后可直接预览，也可下载原件。';
export const knowledgeFileLabel = (type: string) => ({ xls: 'Excel', xlsx: 'Excel', doc: 'Word', docx: 'Word', pdf: 'PDF', jpg: '图片', png: '图片', webp: '图片' }[type] || '附件');

import type { KnowledgeAttachmentDTO, KnowledgePreviewDTO } from '@/types';
import { isOfficeFile } from '@/lib/knowledge-preview-types';
export function knowledgeAttachmentPreview(file: KnowledgeAttachmentDTO): KnowledgePreviewDTO | null {
  const office = isOfficeFile(file.fileType);
  if (!office && !['pdf', 'jpg', 'png', 'webp'].includes(file.fileType)) return null;
  return { fileId: file.id, title: file.displayName || file.originalName, fileType: office ? 'office' : file.fileType === 'pdf' ? 'pdf' : 'image',
    officeType: office ? file.fileType : undefined, contentUrl: file.contentUrl, downloadUrl: file.downloadUrl };
}
