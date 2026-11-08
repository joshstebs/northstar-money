import type {FinancialBrief} from './brief-parser';

export function availableBrief(input: {
  hasData: boolean;
  accountCount: number;
  stale: boolean;
  net: number;
  budgetAttention: number;
}): FinancialBrief {
  const {hasData, accountCount, stale, net, budgetAttention} = input;
  const notes: string[] = [];
  if (!accountCount) notes.push('No household accounts have been added.');
  else if (!hasData) notes.push('There are no classified, posted CAD transactions for this month.');
  if (stale) notes.push('At least one bank connection needs attention or has not refreshed recently.');
  if (!hasData) return {
    brief: 'Your brief will appear once NorthStar has posted activity to review.',
    actions: ['Connect an account or import a card statement.', 'Review the reporting month after your transactions arrive.'],
    dataQualityCaveats: notes
  };
  const amount = new Intl.NumberFormat('en-CA', {style: 'currency', currency: 'CAD'}).format(Math.abs(net));
  return {
    brief: net === 0 ? 'Recorded income and net spending are equal this month.' :
      `Recorded ${net > 0 ? 'income exceeds spending' : 'spending exceeds income'} by ${amount} this month.`,
    actions: [
      budgetAttention ? 'Review the categories approaching or at their monthly limits.' : 'Review category spending against your monthly plan.',
      'Check recent activity and correct any misplaced transactions.'
    ],
    dataQualityCaveats: [...notes, 'This brief reflects recorded CAD activity and may miss transactions that have yet to post or sync.']
  };
}

export function bankDataStale(accounts: {status: string; lastSyncedAt: string | null}[], now = Date.now()) {
  return accounts.some(account => ['active', 'attention'].includes(account.status) &&
    (account.status === 'attention' || !account.lastSyncedAt || now - Date.parse(account.lastSyncedAt) > 3 * 86_400_000));
}
