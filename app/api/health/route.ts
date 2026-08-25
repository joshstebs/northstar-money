import {NextResponse} from 'next/server';
import {db} from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(){
  const startedAt=Date.now();
  try{
    await db.$queryRaw`SELECT 1`;
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
