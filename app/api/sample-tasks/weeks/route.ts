import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError, unauthorized } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { sampleCurrentWeek } from '@/lib/sample-plan-domain';
import { samplePlanQuery, SampleQueryError } from '@/lib/sample-plan-query';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const params = new URLSearchParams(req.nextUrl.searchParams);
    params.delete('week'); params.delete('carry'); params.delete('focusId');
    const q = samplePlanQuery(params, user.employeeId);
    const weeks = await prisma.$queryRaw<Array<{week:string;total:number;unfinished:number}>>(Prisma.sql`
      SELECT COALESCE(to_char(t.plan_week_start_date,'YYYY-MM-DD'),'unplanned') AS week,
      COUNT(*)::int AS total, COUNT(*) FILTER (WHERE t.status NOT IN ('COMPLETED','CANCELLED'))::int AS unfinished
      FROM sample_tasks t WHERE ${q.base} AND (${q.views[q.view]})
      AND (t.plan_week_start_date IS NOT NULL OR t.status NOT IN ('COMPLETED','CANCELLED'))
      GROUP BY t.plan_week_start_date ORDER BY t.plan_week_start_date DESC NULLS LAST`);
    return NextResponse.json({ok:true,currentWeek:sampleCurrentWeek(),weeks});
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof SampleQueryError) return NextResponse.json({ok:false,error:e.message},{status:400});
    console.error('sample week facets failed',e); return NextResponse.json({ok:false,error:'计划周加载失败'},{status:500});
  }
}
