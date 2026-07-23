import crypto from 'node:crypto';
import {cookies, headers} from 'next/headers';
import {NextResponse} from 'next/server';
import {SESSION_COOKIE} from '@/lib/constants';
import {prisma} from '@/lib/prisma';
import {
  canUseRequestMethod,
  type WriteAccessMode,
} from '@/lib/request-authorization';
export type Session={userId:string;username:string;exp:number};
export class UnauthorizedError extends Error{}
export class ForbiddenError extends Error{}
function secret(){const s=process.env.SESSION_SECRET; if(!s||s.length<16) throw new Error('SESSION_SECRET missing or too short'); return s}
function sign(p:string){return crypto.createHmac('sha256',secret()).update(p).digest('base64url')}
export function createToken(u:{userId:string;username:string}){const p=Buffer.from(JSON.stringify({userId:u.userId,username:u.username,exp:Math.floor(Date.now()/1000)+604800})).toString('base64url'); return `${p}.${sign(p)}`}
export function verifyToken(t?:string|null):Session|null{if(!t)return null; const [p,s]=t.split('.'); if(!p||!s)return null; const e=sign(p); if(s.length!==e.length||!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e)))return null; try{const v=JSON.parse(Buffer.from(p,'base64url').toString()) as Session; return v.exp>Math.floor(Date.now()/1000)?v:null}catch{return null}}
export function cookieOptions(){return{httpOnly:true,sameSite:'lax' as const,secure:process.env.NODE_ENV==='production',path:'/',maxAge:604800}}
export async function currentUser(){const s=verifyToken(cookies().get(SESSION_COOKIE)?.value); if(!s)return null; const u=await prisma.user.findUnique({where:{id:s.userId},select:{id:true,username:true,displayName:true,isActive:true,laborRole:true,employeeId:true,employee:{select:{id:true,employeeNo:true,name:true,team:true,isActive:true}}}}); return u&&u.isActive?{id:u.id,username:u.username,displayName:u.displayName,laborRole:u.laborRole,employeeId:u.employeeId,employee:u.employee}:null}
export async function requireUser(options?:{write?:WriteAccessMode}){
  const u=await currentUser();
  if(!u)throw new UnauthorizedError();
  const requestMethod=headers().get('x-hm-request-method');
  if(!canUseRequestMethod(u.laborRole,requestMethod,options?.write))throw new UnauthorizedError();
  return u;
}
export async function requireAdmin(){const u=await currentUser(); if(!u)throw new UnauthorizedError(); if(u.laborRole!=='ADMIN')throw new ForbiddenError(); return u}
export function unauthorized(){
  const authenticated=!!verifyToken(cookies().get(SESSION_COOKIE)?.value);
  const message=authenticated?'当前账号没有执行此操作的权限':'未登录或登录已过期';
  return NextResponse.json({ok:false,error:message,message},{status:authenticated?403:401});
}
export function forbidden(message='当前账号没有执行此操作的权限'){return NextResponse.json({ok:false,error:message,message},{status:403})}
