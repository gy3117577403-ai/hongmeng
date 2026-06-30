import {NextResponse} from 'next/server';
import {SESSION_COOKIE} from '@/lib/constants';
import {currentUser} from '@/lib/auth';
import {logOp} from '@/lib/logs';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function POST(){const u=await currentUser(); if(u)await logOp({userId:u.id,action:'logout',targetType:'user',targetId:u.id}); const res=NextResponse.json({ok:true}); res.cookies.set(SESSION_COOKIE,'',{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:0}); return res}
