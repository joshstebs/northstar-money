import {NextRequest,NextResponse} from 'next/server';
import {db,ownerUser} from '@/lib/db';
import {syncPlaidConnection} from '@/lib/finance/sync-plaid';
import {syncFlinksConnection} from '@/lib/finance/sync-flinks';
import {financialSnapshot} from '@/lib/finance/analytics';
import {generateAdvisorBrief} from '@/lib/ai/advisor';
import {availableBrief, bankDataStale} from '@/lib/finance/advice';
import {balanceTotals} from '@/lib/finance/net-worth';
import {analyzeDuplicateAccounts, duplicateAccountMap} from '@/lib/finance/dedupe';
import {householdDay} from '@/lib/finance/planning';

function torontoParts(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',weekday:'short',day:'2-digit',hour:'2-digit',hour12:false}).formatToParts(new Date());
  return Object.fromEntries(parts.map(x=>[x.type,x.value])) as Record<string,string>;
}

async function saveBrief(type:'weekly'|'monthly'){
  await ownerUser();
  const snapshot=await financialSnapshot();
  if (!snapshot.postedCount) return false;
  const {spentThisMonth, incomeThisMonth, netCashFlow} = snapshot.metrics;
  const budgetAttention = snapshot.budgets.filter(b => b.amount > 0 && b.spent >= .8 * b.amount).length;
  const stale = bankDataStale(snapshot.accounts);
  const fallback = availableBrief({hasData: true, accountCount: snapshot.accounts.length, stale, net: netCashFlow, budgetAttention});
  const ai = await generateAdvisorBrief({spentThisMonth, incomeThisMonth, netCashFlow, budgetAttention, dataQualityCaveats: fallback.dataQualityCaveats}).catch(() => null);
  const title = type === 'monthly' ? 'Monthly financial review' : 'Weekly financial brief';
  const body = JSON.stringify(ai ?? fallback);
  const day = householdDay();
  const id = `owner:${type}:${day}`;
  await db.insight.upsert({where: {id}, update: {body}, create: {id, userId: 'owner', type, title, body}});
  return true;
}

export async function GET(req:NextRequest){
  if(!process.env.CRON_SECRET||req.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return NextResponse.json({error:'Unauthorized'},{status:401});
  const p=torontoParts();
  if(Number(p.hour)!==6)return NextResponse.json({ok:true,skipped:'outside 6 AM Toronto window'});

  const cs=await db.connection.findMany({where:{userId:'owner',provider:{in:['plaid','flinks']}}});
  const results=[] as any[];
  for(const c of cs){
    try{
      results.push({id:c.id,provider:c.provider,ok:true,result:c.provider==='plaid'?await syncPlaidConnection(c.id):c.provider==='flinks'?await syncFlinksConnection(c.id):null});
    }catch(e){
      results.push({id:c.id,provider:c.provider,ok:false,error:e instanceof Error?e.message:'sync failed'});
    }
  }

  const accounts = await db.account.findMany({where: {userId: 'owner'}, include: {connection: true, _count: {select: {transactions: true}}}});
  const duplicateIds = duplicateAccountMap(analyzeDuplicateAccounts(accounts).confirmed);
  const canonical = accounts.filter(a => !duplicateIds.has(a.id));
  const totals = balanceTotals(canonical);
  if (totals.counted && !bankDataStale(canonical.map(a => ({status: a.connection.status, lastSyncedAt: a.connection.lastSyncedAt?.toISOString() ?? null})))) {
    const day = new Date(`${householdDay()}T00:00:00Z`);
    const data = {assets: totals.assets, liabilities: totals.liabilities};
    await db.balanceSnapshot.upsert({where: {userId_day: {userId: 'owner', day}}, update: data, create: {userId: 'owner', day, ...data}});
  }

  const briefs:string[]=[];
  if(p.weekday==='Mon'&&await saveBrief('weekly'))briefs.push('weekly');
  if(p.day==='01'&&await saveBrief('monthly'))briefs.push('monthly');
  return NextResponse.json({ok:true,results,briefs,briefsSkipped:briefs.length===0&&cs.length===0?'no connected accounts':undefined});
}
