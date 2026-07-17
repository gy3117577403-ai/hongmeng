import {ALLOWED_EXTENSIONS,ALLOWED_MIME_TYPES} from '@/lib/constants';
export function maxBytes(){return (Number(process.env.MAX_UPLOAD_SIZE_MB||50)||50)*1024*1024}
export function ext(n:string){const p=n.split('.');return p.length>1?String(p.pop()).toLowerCase():''}
export function fileType(n:string,m:string):'pdf'|'jpg'|'png'|'webp'|'unknown'{const e=ext(n); if(m==='application/pdf'||e==='pdf')return'pdf'; if(m==='image/jpeg'||e==='jpg'||e==='jpeg')return'jpg'; if(m==='image/png'||e==='png')return'png'; if(m==='image/webp'||e==='webp')return'webp'; return'unknown'}
export function validateFile(n:string,m:string,size:number){const e=ext(n); if(!ALLOWED_EXTENSIONS.has(e)||fileType(n,m)==='unknown')return'仅支持 PDF、JPG、JPEG、PNG、WEBP 文件'; if(m&&!ALLOWED_MIME_TYPES.has(m))return'文件 MIME 类型不支持'; if(size<=0)return'文件为空'; if(size>maxBytes())return`单文件不能超过 ${process.env.MAX_UPLOAD_SIZE_MB||50}MB`; return null}
export function validateFileSignature(type:'pdf'|'jpg'|'png'|'webp',body:Uint8Array){
  if(type==='pdf')return body.length>=5&&String.fromCharCode(...body.subarray(0,5))==='%PDF-'?null:'PDF 文件头无效';
  if(type==='jpg')return body.length>=3&&body[0]===0xff&&body[1]===0xd8&&body[2]===0xff?null:'JPEG 文件头无效';
  if(type==='png'){
    const signature=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
    return body.length>=signature.length&&signature.every((value,index)=>body[index]===value)?null:'PNG 文件头无效';
  }
  return body.length>=12&&String.fromCharCode(...body.subarray(0,4))==='RIFF'&&String.fromCharCode(...body.subarray(8,12))==='WEBP'?null:'WEBP 文件头无效';
}
export function validateFileContent(n:string,m:string,size:number,body:Uint8Array){
  const genericError=validateFile(n,m,size);
  if(genericError)return genericError;
  const type=fileType(n,m);
  return type==='unknown'?'文件类型不受支持':validateFileSignature(type,body);
}
export function safeFilename(n:string){return n.normalize('NFKC').replace(/[\\/:*?"<>|#%{}^~`\[\]]/g,'_').replace(/\s+/g,'_').slice(0,160)||'file'}
