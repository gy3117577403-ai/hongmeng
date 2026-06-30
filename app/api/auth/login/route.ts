import bcrypt from 'bcryptjs';
import {NextRequest,NextResponse} from 'next/server';
import {SESSION_COOKIE} from '@/lib/constants';
import {createToken,cookieOptions} from '@/lib/auth';
import {logOp} from '@/lib/logs';
import {prisma} from '@/lib/prisma';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function POST(req:NextRequest){try{const b=await req.json() as {username?:string;password?:string}; const username=b.username?.trim(), password=b.password||''; if(!username||!password)return NextResponse.json({message:'请输入账号和密码'},{status:400}); const u=await prisma.user.findUnique({where:{username}}); if(!u||!u.isActive||!(await bcrypt.compare(password,u.passwordHash)))return NextResponse.json({message:'账号或密码错误'},{status:401}); const res=NextResponse.json({ok:true}); res.cookies.set(SESSION_COOKIE,createToken({userId:u.id,username:u.username}),cookieOptions()); await logOp({userId:u.id,action:'login',targetType:'user',targetId:u.id}); return res}catch(e){console.error(e);return NextResponse.json({message:'登录服务异常'},{status:500})}}
