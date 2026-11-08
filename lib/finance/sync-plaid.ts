import {Prisma} from '@prisma/client';
import type {TransactionsSyncResponse} from 'plaid';
import {db} from '@/lib/db';
import {decryptSecret} from '@/lib/security/crypto';
import {plaidClient} from '@/lib/providers/plaid';

const date = (value?: string | null) => value ? new Date(`${value}T12:00:00.000Z`) : null;

async function readChanges(client: ReturnType<typeof plaidClient>, token: string, initialCursor: string | null) {
  for (let attempt = 0; ; attempt++) {
    const pages: TransactionsSyncResponse[] = [];
    let cursor = initialCursor ?? undefined;
    try {
      do {
        const {data} = await client.transactionsSync({access_token: token, cursor, count: 500});
        pages.push(data);
        cursor = data.next_cursor;
      } while (pages.at(-1)?.has_more);
      return {pages, cursor};
    } catch (error) {
      const code = (error as {response?: {data?: {error_code?: string}}}).response?.data?.error_code;
      if (code !== 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' || attempt >= 2) throw error;
    }
  }
}

export async function syncPlaidConnection(connectionId: string) {
  const connection = await db.connection.findUnique({where: {id: connectionId}});
  if (!connection || connection.provider !== 'plaid' || !connection.encryptedAccessToken) throw new Error('Plaid connection not found');
  const token = decryptSecret(connection.encryptedAccessToken);
  const client = plaidClient();
  try {
    const [{data: {accounts}}, {pages, cursor}] = await Promise.all([
      client.accountsGet({access_token: token}), readChanges(client, token, connection.cursor)
    ]);
    const added = pages.reduce((sum, page) => sum + page.added.length, 0);
    const modified = pages.reduce((sum, page) => sum + page.modified.length, 0);
    const removed = pages.reduce((sum, page) => sum + page.removed.length, 0);
    return await db.$transaction(async tx => {
      const claimed = await tx.connection.updateMany({
        where: {id: connectionId, cursor: connection.cursor, updatedAt: connection.updatedAt},
        data: {cursor, lastSyncedAt: new Date(), lastError: null, status: 'active'}
      });
      if (!claimed.count) return {added: 0, modified: 0, removed: 0, accounts: 0, skipped: 'A newer sync completed.'};
      const accountIds = new Map<string, string>();
      for (const a of accounts) {
        const providerAccountId = a.account_id;
        const data = {
          name: a.name, officialName: a.official_name ?? null, mask: a.mask ?? null, type: String(a.type), subtype: a.subtype ?? null,
          currency: a.balances.iso_currency_code ?? a.balances.unofficial_currency_code ?? 'CAD',
          currentBalance: a.balances.current, availableBalance: a.balances.available
        };
        if (data.type === 'credit' && data.mask && await tx.account.findFirst({
          where: {userId: connection.userId, mask: data.mask, connection: {provider: 'statement'}}, select: {id: true}
        })) throw new Error('A statement-import card has the same last four digits. Keep using statement import to avoid overlapping transactions.');
        const saved = await tx.account.upsert({
          where: {providerAccountId_connectionId: {providerAccountId, connectionId}}, update: data,
          create: {...data, userId: connection.userId, providerAccountId, connectionId}
        });
        accountIds.set(providerAccountId, saved.id);
      }
      const pendingIds: string[] = [];
      for (const page of pages) {
        for (const t of [...page.added, ...page.modified]) {
          const accountId = accountIds.get(t.account_id);
          if (!accountId) continue;
          if (!t.pending && t.pending_transaction_id) pendingIds.push(t.pending_transaction_id);
          const data = {
            merchantName: t.merchant_name ?? null, description: t.name, amount: -t.amount, date: date(t.date)!,
            authorizedDate: date(t.authorized_date), pending: t.pending,
            currency: t.iso_currency_code ?? t.unofficial_currency_code ?? null,
            category: t.personal_finance_category?.primary ?? null, subcategory: t.personal_finance_category?.detailed ?? null
          };
          await tx.transaction.upsert({
            where: {accountId_providerTransactionId: {accountId, providerTransactionId: t.transaction_id}}, update: data,
            create: {...data, accountId, providerTransactionId: t.transaction_id}
          });
        }
        if (page.removed.length) await tx.transaction.deleteMany({where: {
          account: {connectionId}, providerTransactionId: {in: page.removed.map(item => item.transaction_id)}
        }});
      }
      if (pendingIds.length) await tx.transaction.deleteMany({where: {
        account: {connectionId}, pending: true, providerTransactionId: {in: pendingIds}
      }});
      await tx.auditLog.create({data: {userId: connection.userId, action: 'sync_complete', provider: 'plaid', details: JSON.stringify({added, modified, removed})}});
      return {added, modified, removed, accounts: accounts.length};
    }, {timeout: 55_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable});
  } catch (error) {
    const code = (error as {response?: {data?: {error_code?: string}}}).response?.data?.error_code;
    const message = code ? `Plaid sync needs attention (${code}).` : error instanceof Error && error.message.startsWith('A statement-import card') ? error.message : 'Plaid sync failed. Try again.';
    await db.connection.updateMany({where: {id: connectionId, updatedAt: connection.updatedAt}, data: {lastError: message, status: 'attention'}}).catch(() => {});
    throw new Error(message);
  }
}
