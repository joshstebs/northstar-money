import {NextRequest,NextResponse} from 'next/server';
import {db,ownerUser} from '@/lib/db';
import {syncPlaidConnection} from '@/lib/finance/sync-plaid';
import {syncFlinksConnection} from '@/lib/finance/sync-flinks';
import {financialSnapshot} from '@/lib/finance/analytics';
import {generateAdvisorBrief} from '@/lib/ai/advisor';

function torontoParts(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',weekday:'short',day:'2-digit',hour:'2-digit',hour12:false}).formatToParts(new Date());
  return Object.fromEntries(parts.map(x=>[x.type,x.value])) as Record<string,string>;
}

async function saveBrief(type:'weekly'|'monthly'){
  await ownerUser();
  const snapshot=await financialSnapshot();
  if(snapshot.accounts.length===0)return false;
  const ai=await generateAdvisorBrief(snapshot).catch(()=>null);
  const title=type==='monthly'?'Monthly financial review':'Weekly financial brief';
  const body=ai??`Cash flow this month: ${snapshot.metrics.netCashFlow.toFixed(2)} CAD. Potential savings identified from recent category baselines: ${snapshot.metrics.potentialSavings.toFixed(0)} CAD.`;
  await db.insight.create({data:{userId:'owner',type,title,body,amount:snapshot.metrics.potentialSavings}});
  return true;
}

export async function GET(req:NextRequest){
  if(!process.env.CRON_SECRET||req.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return NextResponse.json({error:'Unauthorized'},{status:401});
  const p=torontoParts();
  if(Number(p.hour)!==6)return NextResponse.json({ok:true,skipped:'outside 6 AM Toronto window'});

  const cs=await db.connection.findMany({where:{userId:'owner'}});
  const results=[] as any[];
  for(const c of cs){
    try{
      results.push({id:c.id,provider:c.provider,ok:true,result:c.provider==='plaid'?await syncPlaidConnection(c.id):c.provider==='flinks'?await syncFlinksConnection(c.id):null});
    }catch(e){
      results.push({id:c.id,provider:c.provider,ok:false,error:e instanceof Error?e.message:'sync failed'});
    }
  }

  const briefs:string[]=[];
  if(p.weekday==='Mon'&&await saveBrief('weekly'))briefs.push('weekly');
  if(p.day==='01'&&await saveBrief('monthly'))briefs.push('monthly');
  return NextResponse.json({ok:true,results,briefs,briefsSkipped:briefs.length===0&&cs.length===0?'no connected accounts':undefined});
}
