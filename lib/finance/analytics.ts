import {db} from '@/lib/db';
import {normalizeCategory, householdDay} from './planning';
import {accountKind, classifyTransaction} from './classify';
import {analyzeDuplicateAccounts, dedupeTransactions, duplicateAccountMap} from './dedupe';
import {paymentCadence} from './payroll';
const num=(v:unknown)=>Number(v??0);
const monthKey=(d:Date)=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
export async function financialSnapshot(userId='owner'){
  const now=new Date(), today=new Date(`${householdDay(now)}T12:00:00Z`),monthStart=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),1)),sixMonthsAgo=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-6,1));
  const [accounts,tx,budgets,goals,storedInsights]=await Promise.all([
    db.account.findMany({where:{userId},include:{connection:true,_count:{select:{transactions:true}}},orderBy:{name:'asc'}}),
    db.transaction.findMany({where:{account:{userId},date:{gte:sixMonthsAgo}},include:{account:true},orderBy:{date:'desc'}}),
    db.budget.findMany({where:{userId},orderBy:{month:'desc'}}),
    db.goal.findMany({where:{userId},orderBy:{targetDate:'asc'}}),
    db.insight.findMany({where:{userId,dismissed:false},orderBy:{createdAt:'desc'},take:10})
  ]);
  const duplicates=analyzeDuplicateAccounts(accounts);
  const duplicateIds=duplicateAccountMap(duplicates.confirmed);
  const canonicalAccounts=accounts.filter(account=>!duplicateIds.has(account.id));
  const dedupedTx=dedupeTransactions(tx,duplicateIds);
  const flows = dedupedTx.map(transaction => ({...transaction, ...classifyTransaction(transaction)}));
  const current = flows.filter(t => t.date >= monthStart);
  const postedCount = current.filter(t => ['income', 'spending', 'refund'].includes(t.type)).length;
  const spent = -current.filter(t => t.type === 'spending' || t.type === 'refund').reduce((sum, t) => sum + t.cents, 0) / 100;
  const earned = current.filter(t => t.type === 'income').reduce((sum, t) => sum + t.cents, 0) / 100;
  const categoryMap = new Map<string, number>();
  const monthlyByCategory = new Map<string, Map<string, number>>();
  for (const t of flows.filter(t => t.type === 'spending' || t.type === 'refund')) {
    if (t.date >= monthStart) categoryMap.set(t.category, (categoryMap.get(t.category) ?? 0) - t.cents / 100);
    else {
      const months = monthlyByCategory.get(t.category) ?? new Map<string, number>();
      const month = monthKey(t.date);
      months.set(month, (months.get(month) ?? 0) - t.cents / 100);
      monthlyByCategory.set(t.category, months);
    }
  }
  const categorySpend = [...categoryMap].map(([name, value]) => ({name, value})).sort((a, b) => b.value - a.value);
  const comparable = canonicalAccounts.filter(a => a.currency === 'CAD');
  const liquid = comparable.filter(a => accountKind(a) === 'cash').reduce((sum, a) => sum + num(a.currentBalance), 0);
  const debtAccounts = comparable.filter(a => accountKind(a) === 'debt');
  const debt = debtAccounts.reduce((sum, a) => sum + Math.max(0, num(a.currentBalance)), 0);
  const opportunities = categorySpend.flatMap(c => {
    const past = [...(monthlyByCategory.get(c.name)?.values() ?? [])];
    if (past.length < 3) return [];
    const baseline = past.reduce((a,b) => a + b, 0) / past.length;
    const possibleSavings = Math.max(0, Math.round(c.value - baseline * 1.1));
    return possibleSavings >= 10 ? [{category: c.name, current: c.value, baseline, possibleSavings}] : [];
  }).sort((a, b) => b.possibleSavings - a.possibleSavings);

  const purchases = flows.filter(t => t.type === 'spending');
  const recurringCandidates = new Map<string, {merchant: string; amounts: number[]; dates: Date[]}>();
  for (const t of purchases) {
    const merchant = (t.merchantName || t.description || '').trim();
    if (!merchant) continue;
    const key = merchant.toLowerCase();
    const group = recurringCandidates.get(key) ?? {merchant, amounts: [], dates: []};
    group.amounts.push(-t.cents / 100);
    group.dates.push(t.date);
    recurringCandidates.set(key, group);
  }
  const recurring = [...recurringCandidates.values()].flatMap(group => {
    const cadence = paymentCadence(group.dates, group.amounts);
    if (!cadence) return [];
    const {merchant, amounts, dates} = group;
    return [{merchant, average: amounts.reduce((a, b) => a + b, 0) / amounts.length, occurrences: amounts.length,
      next: new Date(dates[0].getTime() + cadence.days * 86_400_000).toISOString().slice(0, 10), cadence: cadence.label}];
  }).sort((a, b) => a.next.localeCompare(b.next));
  const amounts = purchases.map(t => -t.cents / 100).sort((a, b) => a - b);
  const median = amounts.length >= 5 ? amounts[Math.floor(amounts.length / 2)] : 0;
  const anomalies = purchases.filter(t => median > 0 && -t.cents / 100 >= Math.max(100, median * 4)).slice(0,10)
    .map(t => ({merchant: t.merchantName || t.description, amount: -t.cents / 100, date: t.date.toISOString(), reason: `At least 4× the recent median purchase (${Math.round(median)} CAD)`}));

  const currentBudgets=budgets.filter(b=>monthKey(b.month)===monthKey(monthStart)).map(b=>{const spent=categoryMap.get(normalizeCategory(b.category))??0;return {id:b.id,category:b.category,amount:num(b.amount),spent,remaining:num(b.amount)-spent,percent:num(b.amount)>0?Math.round(spent/num(b.amount)*100):0}});
  const debtPlan=debtAccounts.map(a=>({id:a.id,name:a.name,balance:Math.max(0,num(a.currentBalance)),apr:a.interestRate===null?null:num(a.interestRate),minimumPayment:a.minimumPayment===null?null:num(a.minimumPayment)})).sort((a,b)=>(b.apr??-1)-(a.apr??-1));
  return {postedCount, possibleDuplicateAccounts:duplicates.possible.length, generatedAt:now.toISOString(),metrics:{liquidCash:liquid,creditDebt:debt,spentThisMonth:spent,incomeThisMonth:earned,netCashFlow:earned-spent,potentialSavings:opportunities.reduce((s,x)=>s+x.possibleSavings,0)},accounts:canonicalAccounts.map(a=>({id:a.id,name:a.name,institution:a.connection.institutionName??a.connection.provider,mask:a.mask,type:a.type,balance:a.currentBalance === null ? null : num(a.currentBalance),currency:a.currency,lastSyncedAt:a.connection.lastSyncedAt?.toISOString()??null,status:a.connection.status,apr:a.interestRate===null?null:num(a.interestRate),minimumPayment:a.minimumPayment===null?null:num(a.minimumPayment)})),categorySpend,opportunities,recurring,anomalies,budgets:currentBudgets,goals:goals.map(g=>({id:g.id,name:g.name,targetAmount:num(g.targetAmount),currentAmount:num(g.currentAmount),targetDate:g.targetDate?.toISOString()??null,percent:num(g.targetAmount)>0?Math.min(100,Math.round(num(g.currentAmount)/num(g.targetAmount)*100)):0})),debtPlan,debtPlanReady:debtPlan.length>0&&debtPlan.every(x=>x.apr!==null),storedInsights:storedInsights.map(i=>({id:i.id,type:i.type,title:i.title,body:i.body,amount:i.amount===null?null:num(i.amount),createdAt:i.createdAt.toISOString()})),recentTransactions:dedupedTx.slice(0,30).map(t=>({merchant:t.merchantName??t.description??'Transaction',category:normalizeCategory(t.userCategory || t.category),amount:num(t.amount),currency:t.currency ?? t.account.currency,date:t.date.toISOString(),pending:t.pending}))}
}

