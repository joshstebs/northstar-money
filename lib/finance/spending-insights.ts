import {db} from '@/lib/db';
import {normalizeCategory} from '@/lib/finance/planning';

const CAD = 'CAD';
const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
const monthStart = (year: number, month: number) => new Date(Date.UTC(year, month, 1));
const n = (amount: unknown) => Number(amount ?? 0);

function displayCategory(name: string) {
  return name.toLowerCase().split(' ').map(word => word ? word[0].toUpperCase() + word.slice(1) : word).join(' ');
}

// Money moved between accounts is not new income or a purchase.
// Transactions whose category is unknown are deliberately retained rather than guessed.
function isTransfer(category: string) {
  return /CREDIT CARD PAYMENT|CREDIT CARD REPAYMENT|INTERNAL PAYMENT|ACCOUNT TRANSFER|INTERNAL TRANSFER|TRANSFER BETWEEN ACCOUNTS|OWN ACCOUNT TRANSFER/.test(category);
}

export async function spendingInsights(requestedMonth?: string) {
  const today = new Date();
  const currentMonth = monthStart(today.getUTCFullYear(), today.getUTCMonth());
  const earliestAllowed = monthStart(today.getUTCFullYear(), today.getUTCMonth() - 11);
  const candidate = requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)
    ? new Date(`${requestedMonth}-01T00:00:00.000Z`) : currentMonth;
  const selected = candidate >= earliestAllowed && candidate <= currentMonth ? candidate : currentMonth;
  const selectedKey = monthKey(selected);
  const next = monthStart(selected.getUTCFullYear(), selected.getUTCMonth() + 1);
  const historyStart = monthStart(selected.getUTCFullYear(), selected.getUTCMonth() - 5);
  const [rows, budgets, accounts] = await Promise.all([
    db.transaction.findMany({
      where: {account: {userId: 'owner'}, pending: false, date: {gte: historyStart, lt: next}},
      include: {account: {select: {currency: true, type: true}}},
      orderBy: {date: 'desc'}
    }),
    db.budget.findMany({where: {userId: 'owner', month: {gte: selected, lt: next}}}),
    db.account.findMany({where: {userId: 'owner'}, select: {id: true, currency: true}})
  ]);

  const months = Array.from({length: 6}, (_, i) =>
    monthStart(selected.getUTCFullYear(), selected.getUTCMonth() - (5 - i))
  );
  const monthly = new Map(months.map(date => [monthKey(date), {month: monthKey(date), income: 0, spending: 0}]));
  const categories = new Map<string, number>();
  const merchants = new Map<string, {name: string, amount: number, count: number}>();
  const daily = new Map<number, number>();
  const individualExpenses: Array<{name: string, amount: number, date: string, category: string}> = [];
  let excludedTransfers = 0;
  let excludedForeignCurrency = 0;
  let transactionCount = 0;

  for (const t of rows) {
    if ((t.account.currency || CAD).toUpperCase() !== CAD) {
      excludedForeignCurrency++;
      continue;
    }
    const amount = n(t.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const category = normalizeCategory(t.category);
    const key = monthKey(t.date);
    const month = monthly.get(key);
    if (!month) continue;
    if (isTransfer(category)) {
      if (key === selectedKey) excludedTransfers++;
      continue;
    }
    // Credits to credit cards are normally refunds, payments, or rewards rather than salary.
    if (amount > 0 && /CREDIT|LOAN/.test(t.account.type.toUpperCase())) continue;
    if (amount > 0) month.income += amount;
    else month.spending += -amount;
    if (key !== selectedKey) continue;
    transactionCount++;
    if (amount >= 0) continue;
    const spend = -amount;
    categories.set(category, (categories.get(category) ?? 0) + spend);
    const merchantName = (t.merchantName || t.description || 'Unknown merchant').trim();
    const merchantKey = merchantName.toLowerCase();
    const merchant = merchants.get(merchantKey) ?? {name: merchantName, amount: 0, count: 0};
    merchant.amount += spend; merchant.count++;
    merchants.set(merchantKey, merchant);
    daily.set(t.date.getUTCDate(), (daily.get(t.date.getUTCDate()) ?? 0) + spend);
    individualExpenses.push({name: merchantName, amount: spend, date: t.date.toISOString().slice(0, 10), category: displayCategory(category)});
  }

  const timeline = months.map(date => ({
    ...(monthly.get(monthKey(date))!),
    label: date.toLocaleDateString('en-CA', {month: 'short', timeZone: 'UTC'})
  }));
  const current = timeline[timeline.length - 1];
  const previous = timeline[timeline.length - 2];
  const spending = current.spending;
  const income = current.income;
  const spendByCategory = [...categories.entries()].map(([key, amount]) => ({
    key, name: displayCategory(key), amount,
    share: spending ? Math.round((amount / spending) * 100) : 0
  })).sort((a, b) => b.amount - a.amount);
  const budgetItems = budgets.map(b => {
    const key = normalizeCategory(b.category);
    const limit = n(b.amount);
    const used = categories.get(key) ?? 0;
    return {
      id: b.id, key, name: displayCategory(key), limit, used,
      remaining: limit - used,
      percentage: limit > 0 ? Math.round((used / limit) * 100) : (used > 0 ? 100 : 0)
    };
  }).sort((a, b) => b.percentage - a.percentage);
  const budgeted = budgetItems.reduce((sum, item) => sum + item.limit, 0);
  const usedFromBudgets = budgetItems.reduce((sum, item) => sum + item.used, 0);
  const days = new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth() + 1, 0)).getUTCDate();
  const currentCalendarMonth = selectedKey === monthKey(currentMonth);
  const daysElapsed = currentCalendarMonth ? Math.min(days, today.getUTCDate()) : days;
  const dailySpending = Array.from({length: days}, (_, i) => ({day: i + 1, amount: daily.get(i + 1) ?? 0}));
  const options = Array.from({length: 12}, (_, i) => {
    const date = monthStart(today.getUTCFullYear(), today.getUTCMonth() - i);
    return {value: monthKey(date), label: date.toLocaleDateString('en-CA', {month: 'long', year: 'numeric', timeZone: 'UTC'})};
  });

  const alerts: Array<{level: 'warning' | 'info', title: string, detail: string}> = [];
  if (income > 0 && spending > income) alerts.push({level: 'warning', title: 'Spending is above income', detail: 'Your recorded expenses exceed recorded inflows for this month.'});
  for (const item of budgetItems.filter(b => b.limit > 0 && b.used > b.limit).slice(0, 3)) {
    alerts.push({level: 'warning', title: `${item.name} is over budget`, detail: `Exceeded its monthly limit by ${(item.used - item.limit).toFixed(2)} CAD.`});
  }
  if (previous.spending > 0 && spending > previous.spending * 1.2 && !currentCalendarMonth) {
    alerts.push({level: 'info', title: 'Spending increased', detail: 'Expenses rose more than 20% compared with the previous month.'});
  }
  if (excludedForeignCurrency) alerts.push({level: 'info', title: 'Foreign-currency transactions excluded', detail: 'Non-CAD transactions need conversion before they can be combined accurately with Canadian-dollar totals.'});

  return {
    month: selectedKey, monthLabel: options.find(o => o.value === selectedKey)?.label ?? selectedKey,
    monthOptions: options, hasAccounts: accounts.length > 0,
    hasTransactions: transactionCount > 0, transactionCount,
    income, spending, net: income - spending,
    savingsRate: income > 0 ? Math.round(((income - spending) / income) * 100) : null,
    monthOverMonthSpending: previous.spending > 0 ? Math.round((spending - previous.spending) / previous.spending * 100) : null,
    lastMonthSpending: previous.spending,
    budgeted, usedFromBudgets, budgetItems,
    spendingByCategory: spendByCategory,
    merchants: [...merchants.values()].sort((a, b) => b.amount - a.amount).slice(0, 8),
    largestPurchases: individualExpenses.sort((a, b) => b.amount - a.amount).slice(0, 6),
    monthlyTrend: timeline,
    dailySpending, daysElapsed,
    projectedSpending: currentCalendarMonth && transactionCount > 0 ? Math.round((spending / daysElapsed) * days) : null,
    alerts, excludedTransfers, excludedForeignCurrency,
    note: 'Totals are based on posted CAD transactions. Categorized transfers and credit-card credits are excluded. Income includes positive cash-account inflows; uncategorized refunds can affect totals.'
  };
}
