import {DeleteObjectCommand,DeleteObjectsCommand,ListObjectVersionsCommand,GetObjectCommand,PutObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {createHash} from 'node:crypto';
import {Readable} from 'stream';
function env(n:string){const v=process.env[n]; if(!v) throw new Error(`Missing env ${n}`); return v}
export function bucket(){return env('S3_BUCKET')}
let internalClient:S3Client|undefined;
let externalClient:S3Client|undefined;
function client(endpoint:string){return new S3Client({endpoint,region:process.env.S3_REGION||'auto',forcePathStyle:process.env.S3_FORCE_PATH_STYLE!=='false',maxAttempts:Math.max(1,Number(process.env.S3_MAX_ATTEMPTS)||3),credentials:{accessKeyId:env('S3_ACCESS_KEY_ID'),secretAccessKey:env('S3_SECRET_ACCESS_KEY')}})}
export function s3(){internalClient??=client(env('S3_ENDPOINT'));return internalClient}
function publicS3(){externalClient??=client(process.env.S3_PUBLIC_ENDPOINT||env('S3_ENDPOINT'));return externalClient}
export async function putObject(input:{key:string;body:Buffer;contentType:string;originalName:string}){await s3().send(new PutObjectCommand({Bucket:bucket(),Key:input.key,Body:input.body,ContentType:input.contentType,Metadata:{originalName:encodeURIComponent(input.originalName)}}))}
export async function deleteObject(key:string){await s3().send(new DeleteObjectCommand({Bucket:bucket(),Key:key}))}
/** Delete exact-key versions as well as delete markers; prefix neighbours are never removed. */
export async function purgeObjectVersions(key: string) {
  let keyMarker: string | undefined, versionMarker: string | undefined;
  do {
    const page = await s3().send(new ListObjectVersionsCommand({ Bucket: bucket(), Prefix: key, KeyMarker: keyMarker, VersionIdMarker: versionMarker }));
    const objects = [...(page.Versions || []), ...(page.DeleteMarkers || [])].filter(o => o.Key === key).map(o => ({ Key: key, VersionId: o.VersionId }));
    if (objects.length) {
      const deleted = await s3().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: objects, Quiet: true } }));
      if (deleted.Errors?.length) throw new Error('旧附件版本清理未完成');
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    versionMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  } while (keyMarker);
}
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
export async function getObjectStream(key:string,options:{range?:string;abortSignal?:AbortSignal}={}){const out=await s3().send(new GetObjectCommand({Bucket:bucket(),Key:key,Range:options.range}),options.abortSignal?{abortSignal:options.abortSignal}:undefined); if(!out.Body)throw new Error('S3 object body empty'); return out.Body as Readable}
export async function signedUrl(input:{key:string;filename:string;disposition:'inline'|'attachment';contentType?:string}){return getSignedUrl(publicS3(),new GetObjectCommand({Bucket:bucket(),Key:input.key,ResponseContentDisposition:`${input.disposition}; filename*=UTF-8''${encodeURIComponent(input.filename)}`,ResponseContentType:input.contentType}),{expiresIn:600})}
