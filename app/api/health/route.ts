import {NextResponse} from 'next/server';
import {appInfo} from '@/lib/app-info';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function GET(){return NextResponse.json({ok:true,service:'hongmeng-workorder-resource',app:appInfo(),time:new Date().toISOString()})}
