import {NextResponse} from 'next/server';
import {currentUser,unauthorized} from '@/lib/auth';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function GET(){const user=await currentUser(); return user?NextResponse.json({user}):unauthorized()}
