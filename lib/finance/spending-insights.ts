import {db} from '@/lib/db';
import {normalizeCategory, householdDay} from './planning';
import {budgetStatus, classifyTransaction} from './classify';
import {paymentCadence, payrollSource} from './payroll';

const monthKey = (date: Date) => date.toISOString().slice(0, 7);
const monthStart = (date: Date, offset = 0) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
const calendarDay = (date: Date) => date.toISOString().slice(0, 10);
export const displayCategory = (name: string) => name.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());

type Detail = {id: string; name: string; amount: number; date: string; category: string};

export async function spendingInsights(requestedMonth?: string, period = 6) {
  const today = new Date(`${householdDay()}T12:00:00.000Z`);
  const currentMonth = monthStart(today);
  const firstMonth = monthStart(today, -11);
  const candidate = requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)
    ? new Date(`${requestedMonth}-01T00:00:00.000Z`) : currentMonth;
  const selected = candidate >= firstMonth && candidate <= currentMonth ? candidate : currentMonth;
  const selectedKey = monthKey(selected);
  const previousKey = monthKey(monthStart(selected, -1));
  const budgets = await db.budget.findMany({where: {userId: 'owner', month: {lt: monthStart(selected, 1)}}, orderBy: [{month: 'asc'}, {category: 'asc'}]});
  const hasRollover = budgets.some(item => item.rollover);
  const earliestBudget = budgets[0]?.month;
  const months = Array.from({length: period === 12 ? 12 : 6}, (_, i) => i);
  const timelineMonths = months.map(i => monthStart(selected, i - months.length + 1));
  const next = monthStart(selected, 1);
  const [rows, accounts, sourceRows, household] = await Promise.all([
    db.transaction.findMany({
      where: {account: {userId: 'owner'}, pending: false, date: {gte: hasRollover && earliestBudget && earliestBudget < timelineMonths[0] ? monthStart(earliestBudget) : timelineMonths[0], lt: next}},
      include: {account: {select: {currency: true, type: true, subtype: true}}}, orderBy: {date: 'desc'}
    }),
    db.account.findMany({where: {userId: 'owner'}, select: {id: true}}),
    db.incomeSource.findMany({where: {userId: 'owner'}}),
    db.user.findUnique({where: {id: 'owner'}, select: {budgetWarningPercent: true}})
  ]);
  const warning = household?.budgetWarningPercent ?? 80;
  const sources = new Map(sourceRows.map(row => [row.sourceKey, row.confirmed]));
  const monthly = new Map(timelineMonths.map(date => [monthKey(date), {month: monthKey(date), income: 0, spending: 0, count: 0}]));
  const categories = new Map<string, number>();
  const historicalCategories = new Map<string, Map<string, number>>();
  const merchants = new Map<string, {name: string; trends: Map<string, number>; purchases: Detail[]}>();
  const recurringCandidates = new Map<string, {name: string; amounts: number[]; dates: Date[]}>();
  const incomeGroups = new Map<string, {name: string; identified: boolean; confirmed?: boolean; amounts: number[]; dates: Date[]; transactionId: string}>();
  const daily = new Map<number, number>();
  const expenses: Detail[] = [];
  const review: Detail[] = [];
  let excludedTransfers = 0, excludedForeignCurrency = 0, excludedUnclassified = 0;

  for (const t of rows) {
    const key = monthKey(t.date);
    const month = monthly.get(key);
    const {type, cents, category} = classifyTransaction(t);
    const selectedRow = key === selectedKey;
    if (type === 'ignore') continue;
    if (type === 'transfer') { if (selectedRow) excludedTransfers++; continue; }
    if (type === 'foreign') { if (selectedRow) excludedForeignCurrency++; continue; }
    if (type === 'unclassified') {
      if (selectedRow) {
        excludedUnclassified++;
        review.push({id: t.id, name: t.merchantName || t.description, amount: cents / 100, date: calendarDay(t.date), category});
      }
      continue;
    }

    if (month) month.count++;
    const amount = cents / 100;
    if (type === 'income') {
      if (!month) continue;
      month.income += cents;
      const source = payrollSource(t);
      const confirmed = sources.get(source.key);
      const group = incomeGroups.get(source.key) ?? {name: source.name, identified: false, confirmed, amounts: [], dates: [], transactionId: t.id};
      group.identified ||= source.identified;
      group.amounts.push(amount);
      group.dates.push(t.date);
      incomeGroups.set(source.key, group);
      continue;
    }

    if (month) month.spending -= cents;
    if (!selectedRow) {
      const historical = historicalCategories.get(key) ?? new Map<string, number>();
      historical.set(category, (historical.get(category) ?? 0) - cents);
      historicalCategories.set(key, historical);
    }
    if (!month) continue;
    const name = (t.merchantName || t.description || 'Unknown merchant').trim() || 'Unknown merchant';
    const merchantKey = name.toLowerCase();
    const merchant = merchants.get(merchantKey) ?? {name, trends: new Map<string, number>(), purchases: [] as Detail[]};
    merchant.trends.set(key, (merchant.trends.get(key) ?? 0) - cents);
    merchants.set(merchantKey, merchant);
    if (type === 'spending') {
      const group = recurringCandidates.get(merchantKey) ?? {name, amounts: [], dates: []};
      group.amounts.push(-cents / 100);
      group.dates.push(t.date);
      recurringCandidates.set(merchantKey, group);
    }
    if (!selectedRow) continue;
    categories.set(category, (categories.get(category) ?? 0) - cents);
    daily.set(t.date.getUTCDate(), (daily.get(t.date.getUTCDate()) ?? 0) - cents);
    const item = {id: t.id, name, amount: -amount, date: calendarDay(t.date), category};
    merchant.purchases.push(item);
    expenses.push(item);
  }

  const timeline = timelineMonths.map(date => {
    const row = monthly.get(monthKey(date))!;
    return {...row, income: row.income / 100, spending: row.spending / 100, label: date.toLocaleDateString('en-CA', {month: 'short', timeZone: 'UTC'})};
  });
  const current = timeline.at(-1)!;
  const previous = timeline.at(-2)!;
  const {income, spending, count: transactionCount} = current;
  const positiveCategoryTotal = [...categories.values()].reduce((sum, amount) => sum + Math.max(0, amount), 0);
  const spendingByCategory = [...categories].map(([key, cents]) => ({
    key, name: displayCategory(key), amount: cents / 100,
    share: positiveCategoryTotal ? Math.round(Math.max(0, cents) / positiveCategoryTotal * 100) : 0,
    chartShare: positiveCategoryTotal ? Math.max(0, cents) / positiveCategoryTotal * 100 : 0
  })).sort((a, b) => b.amount - a.amount);
  const savingsOpportunities = spendingByCategory.flatMap(item => {
    if (item.amount <= 0) return [];
    const past = [1, 2, 3].map(offset => historicalCategories.get(monthKey(monthStart(selected, -offset)))?.get(item.key))
      .filter((value): value is number => value !== undefined);
    if (past.length < 2) return [];
    const baseline = past.reduce((sum, value) => sum + Math.max(0, value), 0) / past.length / 100;
    const possibleSavings = Math.max(0, Math.round((item.amount - baseline * 1.1) * 100) / 100);
    return possibleSavings >= 10
      ? [{key: item.key, name: item.name, current: item.amount, baseline: Math.round(baseline * 100) / 100, possibleSavings}]
      : [];
  }).sort((a, b) => b.possibleSavings - a.possibleSavings).slice(0, 6);
  const potentialSavingsTotal = Math.round(savingsOpportunities.reduce((sum, item) => sum + item.possibleSavings, 0) * 100) / 100;
  const recurring = [...recurringCandidates.values()].flatMap(group => {
    const cadence = paymentCadence(group.dates, group.amounts);
    if (!cadence || group.amounts.length < 3) return [];
    const average = group.amounts.reduce((sum, amount) => sum + amount, 0) / group.amounts.length;
    if (average < 5) return [];
    return [{
      merchant: group.name, average: Math.round(average * 100) / 100, occurrences: group.amounts.length,
      next: new Date(group.dates[0].getTime() + cadence.days * 86_400_000).toISOString().slice(0, 10),
      cadence: cadence.label, monthly: Math.round(average * cadence.perMonth * 100) / 100
    }];
  }).sort((a, b) => a.next.localeCompare(b.next)).slice(0, 8);
  const budgetsByMonth = new Map<string, Map<string, typeof budgets>>();
  for (const budget of budgets) {
    const month = monthKey(budget.month);
    const category = normalizeCategory(budget.category);
    const group = budgetsByMonth.get(month) ?? new Map<string, typeof budgets>();
    group.set(category, [...(group.get(category) ?? []), budget]);
    budgetsByMonth.set(month, group);
  }
  let preceding = '';
  let carry = new Map<string, number>();
  const budgetGroups = budgetsByMonth.get(selectedKey) ?? new Map<string, typeof budgets>();
  for (const [month, group] of budgetsByMonth) {
    const immediatelyPrior = monthKey(monthStart(new Date(`${month}-01T00:00:00Z`), -1));
    if (preceding !== immediatelyPrior) carry.clear();
    if (month === selectedKey) break;
    const nextCarry = new Map<string, number>();
    for (const [key, items] of group) {
      if (!items.some(item => item.rollover)) continue;
      const base = items.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0);
      const used = Math.max(0, historicalCategories.get(month)?.get(key) ?? 0);
      nextCarry.set(key, Math.max(0, base + (carry.get(key) ?? 0) - used));
    }
    carry = nextCarry;
    preceding = month;
  }
  const budgetItems = [...budgetGroups].map(([key, items]) => {
    const used = (categories.get(key) ?? 0) / 100;
    const base = items.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0);
    const carried = items.some(item => item.rollover) ? carry.get(key) ?? 0 : 0;
    const limit = (base + carried) / 100;
    const past = [1, 2, 3].map(offset => historicalCategories.get(monthKey(monthStart(selected, -offset)))?.get(key));
    const typical = past.every(value => value !== undefined) ? past.reduce<number>((sum, value) => sum + Math.max(0, value ?? 0), 0) / 300 : null;
    return {
      id: items[0].id, key, name: displayCategory(key), limit, used, remaining: limit - used,
      carry: carried / 100, typical, percentage: limit > 0 ? Math.round(used / limit * 100) : (used > 0 ? 100 : 0),
      status: budgetStatus(used, limit, warning), entries: items.map(item => ({id: item.id, category: item.category, limit: Number(item.amount), rollover: item.rollover}))
    };
  }).sort((a, b) => b.percentage - a.percentage);
  const budgeted = budgetItems.reduce((sum, item) => sum + item.limit, 0);
  const usedFromBudgets = budgetItems.reduce((sum, item) => sum + item.used, 0);
  const days = new Date(next.getTime() - 1).getUTCDate();
  const currentCalendarMonth = selectedKey === monthKey(currentMonth);
  const daysElapsed = currentCalendarMonth ? Math.min(days, today.getUTCDate()) : days;
  const dailySpending = Array.from({length: days}, (_, i) => ({day: i + 1, amount: (daily.get(i + 1) ?? 0) / 100}));
  const options = Array.from({length: 12}, (_, i) => {
    const date = monthStart(today, -i);
    return {value: monthKey(date), label: date.toLocaleDateString('en-CA', {month: 'long', year: 'numeric', timeZone: 'UTC'})};
  });

  const alerts: Array<{level: 'warning' | 'info'; title: string; detail: string; href: string}> = [];
  if (income > 0 && spending > income) alerts.push({level: 'warning', title: 'Spending is above income', detail: `Recorded expenses exceed recorded income by ${(spending - income).toFixed(2)} CAD.`, href: '/insights'});
  for (const item of budgetItems.filter(b => b.status !== 'On track').slice(0, 3)) {
    alerts.push({level: 'warning', title: `${item.name} · ${item.status.toLowerCase()}`, detail: `${item.used.toFixed(2)} CAD used of ${item.limit.toFixed(2)} CAD.`, href: `/advice/budgets?month=${selectedKey}`});
  }
  if (previous.spending > 0 && spending > previous.spending * 1.2 && !currentCalendarMonth) {
    alerts.push({level: 'info', title: 'Spending increased', detail: 'Net expenses rose more than 20% compared with the previous month.', href: '/insights'});
  }
  const qualityNotes = [
    excludedForeignCurrency ? `${excludedForeignCurrency} non-CAD transaction(s) were excluded.` : null,
    excludedUnclassified ? `${excludedUnclassified} transaction(s) need a spending or income category before they can be included.` : null
  ].filter((note): note is string => Boolean(note));

  return {
    month: selectedKey, monthLabel: options.find(o => o.value === selectedKey)?.label ?? selectedKey,
    monthOptions: options, hasAccounts: accounts.length > 0, isCurrentMonth: currentCalendarMonth,
    hasTransactions: transactionCount > 0, transactionCount,
    income, spending, net: (Math.round(income * 100) - Math.round(spending * 100)) / 100,
    savingsRate: income > 0 ? Math.round((income - spending) / income * 100) : null,
    monthOverMonthSpending: previous.spending > 0 && current.count ? Math.round((spending - previous.spending) / previous.spending * 100) : null,
    monthOverMonthIncome: previous.income > 0 && current.count ? Math.round((income - previous.income) / previous.income * 100) : null,
    budgeted, usedFromBudgets, budgetItems, warning,
    unbudgeted: spendingByCategory.filter(c => c.amount > 0 && !budgetGroups.has(c.key)),
    spendingByCategory, expenses, review,
    recurring, savingsOpportunities, potentialSavingsTotal,
    merchants: [...merchants.values()].map(m => ({
      name: m.name, amount: (m.trends.get(selectedKey) ?? 0) / 100, count: m.purchases.filter(p => p.amount > 0).length,
      previous: previous.count ? (m.trends.get(previousKey) ?? 0) / 100 : null,
      purchases: m.purchases, trend: timeline.map(row => ({month: row.month, amount: (m.trends.get(row.month) ?? 0) / 100, available: row.count > 0}))
    })).filter(m => m.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 8),
    largestPurchases: expenses.filter(p => p.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 6),
    payroll: [...incomeGroups].map(([key, group]) => {
      const cadence = paymentCadence(group.dates, group.amounts);
      return {key, transactionId: group.transactionId, name: group.name, identified: group.identified, confirmed: group.confirmed, cadence: cadence?.label,
        monthly: cadence ? group.amounts.slice(0, 4).reduce((sum, amount, _, recent) => sum + amount / recent.length, 0) * cadence.perMonth : null,
        deposits: group.dates.slice(0, 4).map((date, i) => ({date: calendarDay(date), amount: group.amounts[i]}))};
    }).filter(group => group.confirmed !== undefined || group.identified || group.cadence).slice(0, 8),
    monthlyTrend: timeline, dailySpending, daysElapsed, averageDaily: spending / daysElapsed,
    projectedSpending: currentCalendarMonth && daysElapsed >= 7 && transactionCount >= 7 && spending > 0 && daily.size >= 4
      ? Math.round(spending / daysElapsed * days) : null,
    alerts, qualityNotes, excludedTransfers, excludedForeignCurrency, excludedUnclassified,
    note: 'Uses posted CAD activity. Net spending subtracts refunds. Transfers and unclassified credits are excluded. Recent figures may change as transactions post.'
  };
}
