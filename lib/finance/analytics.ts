import {db} from '@/lib/db';
const num=(v:unknown)=>Number(v??0);
export async function financialSnapshot(userId='owner'){
  const now=new Date(),monthStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)),sixMonthsAgo=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-6,1));
  const accounts=await db.account.findMany({where:{userId},include:{connection:true},orderBy:{name:'asc'}});
  const tx=await db.transaction.findMany({where:{account:{userId},date:{gte:sixMonthsAgo}},orderBy:{date:'desc'}});
  const currentMonth=tx.filter(t=>t.date>=monthStart&&!t.pending),spend=currentMonth.filter(t=>num(t.amount)<0),income=currentMonth.filter(t=>num(t.amount)>0);
  const spent=spend.reduce((s,t)=>s+Math.abs(num(t.amount)),0),earned=income.reduce((s,t)=>s+num(t.amount),0);
  const categoryMap=new Map<string,number>();for(const t of spend){const k=(t.category??'Other').replaceAll('_',' ');categoryMap.set(k,(categoryMap.get(k)??0)+Math.abs(num(t.amount)))}
  const categorySpend=[...categoryMap.entries()].map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  const liquid=accounts.filter(a=>['depository','checking','savings','account'].some(x=>a.type.toLowerCase().includes(x)||a.subtype?.toLowerCase().includes(x))).reduce((s,a)=>s+num(a.currentBalance),0);
  const debt=accounts.filter(a=>['credit','loan'].some(x=>a.type.toLowerCase().includes(x)||a.subtype?.toLowerCase().includes(x))).reduce((s,a)=>s+Math.abs(num(a.currentBalance)),0);
  const monthlyByCategory=new Map<string,number[]>();
  for(let offset=1;offset<=6;offset++){const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-offset,1)),end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-offset+1,1));for(const t of tx.filter(x=>x.date>=start&&x.date<end&&num(x.amount)<0&&!x.pending)){const k=(t.category??'Other').replaceAll('_',' ');const arr=monthlyByCategory.get(k)??Array(6).fill(0);arr[offset-1]+=Math.abs(num(t.amount));monthlyByCategory.set(k,arr)}}
  const opportunities=categorySpend.map(c=>{const past=monthlyByCategory.get(c.name)??[],baseline=past.length?past.reduce((a,b)=>a+b,0)/6:0,excess=Math.max(0,c.value-baseline*1.1);return {category:c.name,current:c.value,baseline,possibleSavings:Math.round(excess)}}).filter(x=>x.possibleSavings>=10).sort((a,b)=>b.possibleSavings-a.possibleSavings);
  const recurringCandidates=new Map<string,{merchant:string,amounts:number[],dates:Date[]}>();for(const t of tx.filter(x=>num(x.amount)<0)){const merchant=(t.merchantName??t.description??'').trim().toLowerCase();if(!merchant)continue;const x=recurringCandidates.get(merchant)??{merchant:t.merchantName??t.description??merchant,amounts:[],dates:[]};x.amounts.push(Math.abs(num(t.amount)));x.dates.push(t.date);recurringCandidates.set(merchant,x)}
  const recurring=[...recurringCandidates.values()].filter(x=>x.amounts.length>=3).map(x=>({merchant:x.merchant,average:x.amounts.reduce((a,b)=>a+b,0)/x.amounts.length,occurrences:x.amounts.length})).sort((a,b)=>b.average-a.average).slice(0,15);
  return {generatedAt:now.toISOString(),metrics:{liquidCash:liquid,creditDebt:debt,spentThisMonth:spent,incomeThisMonth:earned,netCashFlow:earned-spent,potentialSavings:opportunities.reduce((s,x)=>s+x.possibleSavings,0)},accounts:accounts.map(a=>({id:a.id,name:a.name,institution:a.connection.institutionName??a.connection.provider,mask:a.mask,type:a.type,balance:num(a.currentBalance),currency:a.currency,lastSyncedAt:a.connection.lastSyncedAt?.toISOString()??null,status:a.connection.status})),categorySpend,opportunities,recurring,recentTransactions:tx.slice(0,30).map(t=>({merchant:t.merchantName??t.description??'Transaction',category:(t.category??'Other').replaceAll('_',' '),amount:num(t.amount),date:t.date.toISOString(),pending:t.pending}))}
}
