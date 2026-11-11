import {db} from '@/lib/db';
import {accountKind} from './classify';
import {analyzeDuplicateAccounts, duplicateAccountMap} from './dedupe';

type Balance = {type: string; subtype?: string | null; currency: string; currentBalance: unknown};

export function balanceTotals(accounts: Balance[]) {
  let assets = 0, liabilities = 0, counted = 0, excluded = 0;
  for (const account of accounts) {
    const kind = accountKind(account);
    const cents = Math.round(Number(account.currentBalance) * 100);
    if (account.currency.toUpperCase() !== 'CAD' || account.currentBalance === null || !Number.isSafeInteger(cents) || kind === 'unknown') {
      excluded++;
      continue;
    }
    counted++;
    // Plaid and manual debts are positive owed balances. Flinks debt signs are normalized at ingestion.
    if (kind === 'debt') {
      if (cents >= 0) liabilities += cents;
      else assets -= cents;
    } else if (cents >= 0) assets += cents;
    else liabilities -= cents;
  }
  return {assets: assets / 100, liabilities: liabilities / 100, net: (assets - liabilities) / 100, counted, excluded};
}

export async function netWorth(userId = 'owner') {
  const [accounts, snapshots] = await Promise.all([
    db.account.findMany({where: {userId}, include: {connection: {select: {provider: true, status: true, lastSyncedAt: true, institutionName: true}}, _count: {select: {transactions: true}}}, orderBy: {name: 'asc'}}),
    db.balanceSnapshot.findMany({where: {userId}, orderBy: {day: 'desc'}, take: 370})
  ]);
  const analysis = analyzeDuplicateAccounts(accounts);
  const duplicateIds = duplicateAccountMap(analysis.confirmed);
  const canonical = accounts.filter(account => !duplicateIds.has(account.id));
  const balances = canonical.map(account => ({...account, currentBalance: account.currentBalance === null ? null : Number(account.currentBalance)}));
  return {
    ...balanceTotals(balances), accounts: balances, duplicateAccounts: duplicateIds.size, possibleDuplicateAccounts: analysis.possible.length,
    history: snapshots.reverse().map(row => ({date: row.day.toISOString().slice(0, 10), assets: Number(row.assets), liabilities: Number(row.liabilities), net: Number(row.assets.minus(row.liabilities))}))
  };
}
