import {NextResponse} from 'next/server';
import {db} from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(){
  const startedAt=Date.now();
  try{
    const [schema] = await db.$queryRaw<{ready: boolean}[]>`
      SELECT to_regclass('public."BalanceSnapshot"') IS NOT NULL
         AND to_regclass('public."GoalContribution"') IS NOT NULL
         AND to_regclass('public."IncomeSource"') IS NOT NULL AS ready
    `;
    if (!schema?.ready) {
      return NextResponse.json({status: 'degraded', database: 'migration required', version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0,7) ?? 'local'},
        {status: 503, headers: {'Cache-Control': 'no-store'}});
    }
    return NextResponse.json({
      status:'ok',
      database:'ok',
      version:process.env.VERCEL_GIT_COMMIT_SHA?.slice(0,7)??'local',
      responseMs:Date.now()-startedAt
    },{headers:{'Cache-Control':'no-store'}});
  }catch{
    return NextResponse.json({
      status:'degraded',
      database:'unavailable',
      version:process.env.VERCEL_GIT_COMMIT_SHA?.slice(0,7)??'local',
      responseMs:Date.now()-startedAt
    },{status:503,headers:{'Cache-Control':'no-store'}});
  }
}
