export const KNOWLEDGE_FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx';
export const KNOWLEDGE_FILE_HELP = '支持 Excel（xls、xlsx）、Word（doc、docx）、PDF 和图片。Excel / Word 下载后打开。';
export const knowledgeFileLabel = (type: string) => ({ xls: 'Excel', xlsx: 'Excel', doc: 'Word', docx: 'Word', pdf: 'PDF', jpg: '图片', png: '图片', webp: '图片' }[type] || '附件');
