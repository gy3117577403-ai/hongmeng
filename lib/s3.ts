import {DeleteObjectCommand,GetObjectCommand,PutObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {createHash} from 'node:crypto';
import {Readable} from 'stream';
function env(n:string){const v=process.env[n]; if(!v) throw new Error(`Missing env ${n}`); return v}
export function bucket(){return env('S3_BUCKET')}
export function s3(){return new S3Client({endpoint:env('S3_ENDPOINT'),region:process.env.S3_REGION||'auto',forcePathStyle:process.env.S3_FORCE_PATH_STYLE!=='false',credentials:{accessKeyId:env('S3_ACCESS_KEY_ID'),secretAccessKey:env('S3_SECRET_ACCESS_KEY')}})}
function publicS3(){return new S3Client({endpoint:process.env.S3_PUBLIC_ENDPOINT||env('S3_ENDPOINT'),region:process.env.S3_REGION||'auto',forcePathStyle:process.env.S3_FORCE_PATH_STYLE!=='false',credentials:{accessKeyId:env('S3_ACCESS_KEY_ID'),secretAccessKey:env('S3_SECRET_ACCESS_KEY')}})}
export async function putObject(input:{key:string;body:Buffer;contentType:string;originalName:string}){await s3().send(new PutObjectCommand({Bucket:bucket(),Key:input.key,Body:input.body,ContentType:input.contentType,Metadata:{originalName:encodeURIComponent(input.originalName)}}))}
export async function deleteObject(key:string){await s3().send(new DeleteObjectCommand({Bucket:bucket(),Key:key}))}
export type S3CleanupSummary={requested:number;deleted:number;failed:number};
export function s3ObjectKeyFingerprint(key:string){return createHash('sha256').update(key).digest('hex').slice(0,12)}
function cleanupErrorName(reason:unknown){
  const name=reason&&typeof reason==='object'&&'name' in reason?String(reason.name):'UnknownError';
  return /^[A-Za-z0-9_.-]{1,64}$/.test(name)?name:'UnknownError';
}
function cleanupHttpStatus(reason:unknown){
  if(!reason||typeof reason!=='object'||!('$metadata' in reason)) return undefined;
  const metadata=reason.$metadata;
  if(!metadata||typeof metadata!=='object'||!('httpStatusCode' in metadata)) return undefined;
  const status=metadata.httpStatusCode;
  return typeof status==='number'&&Number.isInteger(status)?status:undefined;
}
export async function deleteObjectsBestEffort(
  keys:string[],
  remove:(key:string)=>Promise<void>=deleteObject,
):Promise<S3CleanupSummary>{
  const uniqueKeys=[...new Set(keys.filter(Boolean))];
  const results=await Promise.allSettled(uniqueKeys.map(key=>remove(key)));
  let failed=0;
  results.forEach((result,index)=>{
    if(result.status!=='rejected') return;
    failed+=1;
    console.error('[s3-cleanup] best-effort object deletion failed',{
      keyFingerprint:s3ObjectKeyFingerprint(uniqueKeys[index]),
      errorName:cleanupErrorName(result.reason),
      httpStatusCode:cleanupHttpStatus(result.reason),
    });
  });
  return {requested:uniqueKeys.length,deleted:uniqueKeys.length-failed,failed};
}
export async function getObjectStream(key:string){const out=await s3().send(new GetObjectCommand({Bucket:bucket(),Key:key})); if(!out.Body)throw new Error('S3 object body empty'); return out.Body as Readable}
export async function signedUrl(input:{key:string;filename:string;disposition:'inline'|'attachment';contentType?:string}){return getSignedUrl(publicS3(),new GetObjectCommand({Bucket:bucket(),Key:input.key,ResponseContentDisposition:`${input.disposition}; filename*=UTF-8''${encodeURIComponent(input.filename)}`,ResponseContentType:input.contentType}),{expiresIn:600})}
