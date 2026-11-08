import {Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {db} from '@/lib/db';
import {decryptSecret, encryptSecret} from '@/lib/security/crypto';
import {authorizeLogin, getAccountsDetail} from '@/lib/providers/flinks';
import {accountKind} from './classify';

export async function createFlinksConnection(loginId: string, institution?: string | null) {
  const providerItemId = `flinks:${createHash('sha256').update(loginId).digest('hex')}`;
  const encryptedAccessToken = encryptSecret(loginId);
  return db.connection.upsert({
    where: {provider_providerItemId: {provider: 'flinks', providerItemId}},
    update: {encryptedAccessToken, institutionName: institution ?? undefined, status: 'active', lastError: null},
    create: {userId: 'owner', provider: 'flinks', providerItemId, encryptedAccessToken, institutionName: institution ?? null}
  });
}

export async function syncFlinksConnection(connectionId: string) {
  const connection = await db.connection.findUnique({where: {id: connectionId}});
  if (!connection || connection.provider !== 'flinks' || !connection.encryptedAccessToken) throw new Error('Flinks connection not found');
  try {
    const auth = await authorizeLogin(decryptSecret(connection.encryptedAccessToken));
    const detail = await getAccountsDetail(auth.requestId);
    return await db.$transaction(async tx => {
      const claimed = await tx.connection.updateMany({
        where: {id: connectionId, updatedAt: connection.updatedAt},
        data: {institutionName: detail.InstitutionName ?? auth.institutionName ?? connection.institutionName, lastSyncedAt: new Date(), lastError: null, status: 'active'}
      });
      if (!claimed.count) return {transactions: 0, accounts: 0, skipped: 'A newer sync completed.'};
      let count = 0;
      for (const a of detail.Accounts ?? []) {
        const providerAccountId = String(a.Id ?? a.AccountId ?? a.AccountNumber ?? `${a.Title}:${a.LastFourDigits ?? ''}`);
        const rawBalance = a.Balance?.Current ?? a.CurrentBalance ?? null;
        const type = String(a.Category ?? a.Type ?? 'account');
        const subtype = a.AccountType ? String(a.AccountType) : null;
        const mask = a.LastFourDigits ? String(a.LastFourDigits) : null;
        const debt = accountKind({type, subtype}) === 'debt';
        if (debt && mask && await tx.account.findFirst({
          where: {userId: connection.userId, mask, connection: {provider: 'statement'}}, select: {id: true}
        })) throw new Error('A statement-import card has the same last four digits. Keep using statement import to avoid overlapping transactions.');
        const data = {
          name: String(a.Title ?? a.Name ?? 'Flinks account'), mask, type, subtype, currency: String(a.Currency ?? 'CAD'),
          currentBalance: rawBalance === null ? null : debt ? Math.abs(Number(rawBalance)) : rawBalance,
          availableBalance: a.Balance?.Available ?? a.AvailableBalance ?? null
        };
        const account = await tx.account.upsert({
          where: {providerAccountId_connectionId: {providerAccountId, connectionId}}, update: data,
          create: {...data, userId: connection.userId, connectionId, providerAccountId}
        });
        const occurrences = new Map<string, number>();
        for (const t of a.Transactions ?? []) {
          const day = String(t.Date ?? '').slice(0, 10);
          const date = new Date(`${day}T12:00:00.000Z`);
          const amount = Number(t.Credit ?? 0) - Number(t.Debit ?? 0);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day || !Number.isFinite(amount)) continue;
          const baseId = createHash('sha256').update(`${providerAccountId}|${t.Date}|${t.Description}|${t.Debit}|${t.Credit}`).digest('hex');
          const ordinal = (occurrences.get(baseId) ?? 0) + 1;
          occurrences.set(baseId, ordinal);
          const providerTransactionId = String(t.Id ?? (ordinal === 1 ? baseId : `${baseId}:${ordinal}`));
          const data = {
            description: String(t.Description ?? ''), amount, date, category: t.Category ? String(t.Category) : null,
            subcategory: t.CategoryType ? String(t.CategoryType) : null,
            pending: t.Pending === true || t.IsPending === true || String(t.Status ?? '').toLowerCase() === 'pending',
            currency: t.Currency ? String(t.Currency) : null
          };
          await tx.transaction.upsert({
            where: {accountId_providerTransactionId: {accountId: account.id, providerTransactionId}}, update: data,
            create: {...data, accountId: account.id, providerTransactionId}
          });
          count++;
        }
      }
      await tx.auditLog.create({data: {userId: connection.userId, action: 'sync_complete', provider: 'flinks', details: JSON.stringify({transactions: count, accounts: detail.Accounts?.length ?? 0})}});
      return {transactions: count, accounts: detail.Accounts?.length ?? 0};
    }, {timeout: 55_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable});
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith('A statement-import card') ? error.message : 'Flinks sync needs attention. Try reconnecting.';
    await db.connection.updateMany({where: {id: connectionId, updatedAt: connection.updatedAt}, data: {lastError: message, status: 'attention'}}).catch(() => {});
    throw new Error(message);
  }
}
