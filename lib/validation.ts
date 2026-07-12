import {ALLOWED_EXTENSIONS,ALLOWED_MIME_TYPES} from '@/lib/constants';
export function maxBytes(){return (Number(process.env.MAX_UPLOAD_SIZE_MB||50)||50)*1024*1024}
export function ext(n:string){const p=n.split('.');return p.length>1?String(p.pop()).toLowerCase():''}
export function fileType(n:string,m:string):'pdf'|'jpg'|'png'|'webp'|'unknown'{const e=ext(n); if(m==='application/pdf'||e==='pdf')return'pdf'; if(m==='image/jpeg'||e==='jpg'||e==='jpeg')return'jpg'; if(m==='image/png'||e==='png')return'png'; if(m==='image/webp'||e==='webp')return'webp'; return'unknown'}
export function validateFile(n:string,m:string,size:number){const e=ext(n); if(!ALLOWED_EXTENSIONS.has(e)||fileType(n,m)==='unknown')return'仅支持 PDF、JPG、JPEG、PNG、WEBP 文件'; if(m&&!ALLOWED_MIME_TYPES.has(m))return'文件 MIME 类型不支持'; if(size<=0)return'文件为空'; if(size>maxBytes())return`单文件不能超过 ${process.env.MAX_UPLOAD_SIZE_MB||50}MB`; return null}
export function safeFilename(n:string){return n.normalize('NFKC').replace(/[\\/:*?"<>|#%{}^~`\[\]]/g,'_').replace(/\s+/g,'_').slice(0,160)||'file'}
