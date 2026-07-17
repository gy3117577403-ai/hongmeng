import {DeleteObjectCommand,GetObjectCommand,PutObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {Readable} from 'stream';
function env(n:string){const v=process.env[n]; if(!v) throw new Error(`Missing env ${n}`); return v}
export function bucket(){return env('S3_BUCKET')}
export function s3(){return new S3Client({endpoint:env('S3_ENDPOINT'),region:process.env.S3_REGION||'auto',forcePathStyle:process.env.S3_FORCE_PATH_STYLE!=='false',credentials:{accessKeyId:env('S3_ACCESS_KEY_ID'),secretAccessKey:env('S3_SECRET_ACCESS_KEY')}})}
function publicS3(){return new S3Client({endpoint:process.env.S3_PUBLIC_ENDPOINT||env('S3_ENDPOINT'),region:process.env.S3_REGION||'auto',forcePathStyle:process.env.S3_FORCE_PATH_STYLE!=='false',credentials:{accessKeyId:env('S3_ACCESS_KEY_ID'),secretAccessKey:env('S3_SECRET_ACCESS_KEY')}})}
export async function putObject(input:{key:string;body:Buffer;contentType:string;originalName:string}){await s3().send(new PutObjectCommand({Bucket:bucket(),Key:input.key,Body:input.body,ContentType:input.contentType,Metadata:{originalName:encodeURIComponent(input.originalName)}}))}
export async function deleteObject(key:string){await s3().send(new DeleteObjectCommand({Bucket:bucket(),Key:key}))}
export async function deleteObjectsBestEffort(keys:string[]){await Promise.allSettled(keys.map(key=>deleteObject(key)))}
export async function getObjectStream(key:string){const out=await s3().send(new GetObjectCommand({Bucket:bucket(),Key:key})); if(!out.Body)throw new Error('S3 object body empty'); return out.Body as Readable}
export async function signedUrl(input:{key:string;filename:string;disposition:'inline'|'attachment';contentType?:string}){return getSignedUrl(publicS3(),new GetObjectCommand({Bucket:bucket(),Key:input.key,ResponseContentDisposition:`${input.disposition}; filename*=UTF-8''${encodeURIComponent(input.filename)}`,ResponseContentType:input.contentType}),{expiresIn:600})}
