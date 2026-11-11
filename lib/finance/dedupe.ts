import {accountKind} from './classify';

export type DedupeAccount = {
  id: string;
  userId?: string | null;
  connectionId: string;
  mask?: string | null;
  name?: string | null;
  type: string;
  subtype?: string | null;
  currency?: string | null;
  currentBalance?: unknown;
  _count?: {transactions?: number | null} | null;
  connection?: {
    provider?: string | null;
    status?: string | null;
    institutionName?: string | null;
    lastSyncedAt?: Date | string | null;
  } | null;
};

export type DedupeTransaction = {
  id?: string;
  accountId: string;
  amount: unknown;
  date: Date | string;
  merchantName?: string | null;
  description?: string | null;
  pending?: boolean | null;
};

export type DuplicateGroup = {
  canonicalId: string;
  duplicateIds: string[];
  accountIds: string[];
};

export type PossibleDuplicateGroup = {
  accountIds: string[];
  reason: string;
};

export type DuplicateAnalysis = {
  confirmed: DuplicateGroup[];
  possible: PossibleDuplicateGroup[];
};

const INSTITUTION_STOPWORDS = new Set([
  'bank', 'banking', 'the', 'of', 'and', 'inc', 'ltd', 'corp', 'corporation',
  'group', 'financial', 'canada', 'canadian', 'trust', 'company', 'co', 'services'
]);

const ACCOUNT_NAME_STOPWORDS = new Set(['account', 'accounts', 'the', 'my', 'card', 'cards']);

const toCents = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed * 100);
  return Number.isSafeInteger(rounded) ? rounded : null;
};

const normalizeText = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const maskOf = (account: DedupeAccount) => {
  const value = String(account.mask ?? '').trim();
  return /^\d{4}$/.test(value) ? value : null;
};
const currencyOf = (account: DedupeAccount) => String(account.currency ?? '').trim().toUpperCase();

export function institutionTokens(name?: string | null) {
  return normalizeText(name).split(' ').filter(token => token && !INSTITUTION_STOPWORDS.has(token));
}

export function accountNameTokens(name?: string | null) {
  return normalizeText(name).split(' ').filter(token => token && !ACCOUNT_NAME_STOPWORDS.has(token));
}

function tokenMatch(left: string[], right: string[]) {
  if (!left.length || !right.length) return null;
  const rightSet = new Set(right);
  const overlap = left.filter(token => rightSet.has(token)).length;
  if (!overlap) return false;
  return overlap / Math.min(left.length, right.length) >= 0.5;
}

// Returns true/false when both names are usable, or null when a name is missing.
export function institutionsMatch(left?: string | null, right?: string | null) {
  return tokenMatch(institutionTokens(left), institutionTokens(right));
}

// Returns true/false when both names are usable, or null when a name is missing.
export function accountNamesMatch(left?: string | null, right?: string | null) {
  return tokenMatch(accountNameTokens(left), accountNameTokens(right));
}

const providerRank = (provider?: string | null) =>
  provider === 'plaid' ? 3 : provider === 'statement' ? 2 : provider === 'flinks' ? 1 : 0;

function compareAccounts(left: DedupeAccount, right: DedupeAccount) {
  const active = Number(right.connection?.status === 'active') - Number(left.connection?.status === 'active');
  if (active) return active;
  const count = (account: DedupeAccount) => {
    const value = Number(account._count?.transactions ?? 0);
    return Number.isFinite(value) ? Math.min(value, 1_000_000) : 0;
  };
  const transactions = count(right) - count(left);
  if (transactions) return transactions;
  const provider = providerRank(right.connection?.provider) - providerRank(left.connection?.provider);
  if (provider) return provider;
  const synced = Number(Boolean(right.connection?.lastSyncedAt)) - Number(Boolean(left.connection?.lastSyncedAt));
  if (synced) return synced;
  return left.id.localeCompare(right.id);
}

type Pair = {confirmed: boolean; reason: string};

/**
 * Evaluates whether two accounts can describe the same real account. Identity is only
 * confirmed when the accounts belong to the same user but different providers and their
 * institution, account name, four-digit mask, currency and type all agree. A missing or
 * conflicting signal downgrades the pair to a possible duplicate; balances are never used.
 */
function evaluatePair(left: DedupeAccount, right: DedupeAccount): Pair | null {
  if (left.id === right.id || left.connectionId === right.connectionId) return null;
  if ((left.userId ?? '') !== (right.userId ?? '')) return null;
  const currency = currencyOf(left);
  if (!currency || currency !== currencyOf(right)) return null;
  const mask = maskOf(left);
  if (!mask || mask !== maskOf(right)) return null;

  const leftKind = accountKind(left);
  const rightKind = accountKind(right);
  if (leftKind !== 'unknown' && rightKind !== 'unknown' && leftKind !== rightKind) return null;

  const institutions = institutionsMatch(left.connection?.institutionName, right.connection?.institutionName);
  const names = accountNamesMatch(left.name, right.name);
  if (institutions === false || names === false) return null;

  const leftProvider = left.connection?.provider;
  const rightProvider = right.connection?.provider;
  const crossProvider = Boolean(leftProvider && rightProvider && leftProvider !== rightProvider);

  if (institutions === true && names === true && crossProvider) {
    return {confirmed: true, reason: 'Matching institution, account name, mask, currency and type across providers'};
  }
  const reason = !crossProvider
    ? 'Linked through the same provider; identity cannot be confirmed'
    : institutions !== true
      ? 'Institution name is missing or differs; identity cannot be confirmed'
      : 'Account name is missing or differs; identity cannot be confirmed';
  return {confirmed: false, reason};
}

const createUnionFind = () => {
  const parent = new Map<string, string>();
  const ensure = (id: string) => { if (!parent.has(id)) parent.set(id, id); };
  const find = (id: string): string => {
    ensure(id);
    let root = id;
    while (root !== parent.get(root)) root = parent.get(root)!;
    while (id !== root) {
      const next = parent.get(id)!;
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const left = find(a);
    const right = find(b);
    if (left !== right) parent.set(left, right);
  };
  return {find, union};
};

/**
 * Groups accounts that may represent the same real account. Only pairs from the same user,
 * with the same four-digit mask and currency, are compared. Confirmed duplicates are safe to
 * collapse for reporting; possible duplicates are left untouched and reported for review.
 * This function never mutates or deletes stored accounts.
 */
export function analyzeDuplicateAccounts(accounts: DedupeAccount[]): DuplicateAnalysis {
  const candidates = accounts.filter(account => maskOf(account) && currencyOf(account));
  const buckets = new Map<string, DedupeAccount[]>();
  for (const account of candidates) {
    const key = `${maskOf(account)}|${currencyOf(account)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(account);
    buckets.set(key, bucket);
  }

  const edges: Array<{a: string; b: string; pair: Pair}> = [];
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const pair = evaluatePair(bucket[i], bucket[j]);
        if (pair) edges.push({a: bucket[i].id, b: bucket[j].id, pair});
      }
    }
  }

  const confirmedUF = createUnionFind();
  for (const edge of edges) if (edge.pair.confirmed) confirmedUF.union(edge.a, edge.b);

  const confirmedClusters = new Map<string, DedupeAccount[]>();
  for (const account of candidates) {
    if (!edges.some(edge => edge.pair.confirmed && (edge.a === account.id || edge.b === account.id))) continue;
    const root = confirmedUF.find(account.id);
    const cluster = confirmedClusters.get(root) ?? [];
    cluster.push(account);
    confirmedClusters.set(root, cluster);
  }

  const confirmed: DuplicateGroup[] = [];
  const accountRoot = new Map<string, string>();
  for (const cluster of confirmedClusters.values()) {
    if (cluster.length < 2) continue;
    const ordered = [...cluster].sort(compareAccounts);
    const [canonical, ...duplicates] = ordered;
    for (const account of cluster) accountRoot.set(account.id, canonical.id);
    confirmed.push({
      canonicalId: canonical.id,
      duplicateIds: duplicates.map(account => account.id),
      accountIds: ordered.map(account => account.id)
    });
  }
  confirmed.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));

  const possibleEdges = edges.filter(edge => !edge.pair.confirmed
    && !(accountRoot.get(edge.a) && accountRoot.get(edge.a) === accountRoot.get(edge.b)));
  const possibleUF = createUnionFind();
  for (const edge of possibleEdges) possibleUF.union(edge.a, edge.b);

  const possibleClusters = new Map<string, {ids: Set<string>; reasons: Set<string>}>();
  for (const edge of possibleEdges) {
    const root = possibleUF.find(edge.a);
    const cluster = possibleClusters.get(root) ?? {ids: new Set<string>(), reasons: new Set<string>()};
    cluster.ids.add(edge.a);
    cluster.ids.add(edge.b);
    cluster.reasons.add(edge.pair.reason);
    possibleClusters.set(root, cluster);
  }

  const possible: PossibleDuplicateGroup[] = [...possibleClusters.values()]
    .map(cluster => ({
      accountIds: [...cluster.ids].sort(),
      reason: [...cluster.reasons].sort().join('; ')
    }))
    .filter(group => group.accountIds.length > 1)
    .sort((a, b) => a.accountIds[0].localeCompare(b.accountIds[0]));

  return {confirmed, possible};
}

export function duplicateAccountMap(groups: DuplicateGroup[]) {
  const map = new Map<string, string>();
  for (const group of groups) for (const id of group.duplicateIds) map.set(id, group.canonicalId);
  return map;
}

const dayKey = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : String(value);
};

const transactionFingerprint = (transaction: DedupeTransaction) => {
  const cents = toCents(transaction.amount);
  if (cents === null) return null;
  const merchant = normalizeText(transaction.merchantName || transaction.description);
  const state = transaction.pending ? 'pending' : 'posted';
  return `${dayKey(transaction.date)}|${cents}|${merchant}|${state}`;
};

/**
 * Removes transactions duplicated across accounts in a confirmed duplicate group while keeping
 * legitimate repeats: for a given day/amount/merchant/state fingerprint it keeps as many copies
 * as the provider that reported the most. Transactions on accounts outside a confirmed group are
 * never compared with each other. This only filters in-memory rows for reporting.
 */
export function dedupeTransactions<T extends DedupeTransaction>(transactions: T[], duplicateToCanonical: Map<string, string>): T[] {
  if (!duplicateToCanonical.size) return transactions;

  const accountGroup = new Map<string, string>();
  for (const [duplicateId, canonicalId] of duplicateToCanonical) {
    accountGroup.set(duplicateId, canonicalId);
    accountGroup.set(canonicalId, canonicalId);
  }

  const buckets = new Map<string, Array<{index: number; transaction: T}>>();
  const groupedIndexes = new Set<number>();
  transactions.forEach((transaction, index) => {
    const canonicalId = accountGroup.get(transaction.accountId);
    if (!canonicalId) return;
    const fingerprint = transactionFingerprint(transaction);
    if (fingerprint === null) return;
    const key = `${canonicalId}\u0000${fingerprint}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push({index, transaction});
    buckets.set(key, bucket);
    groupedIndexes.add(index);
  });

  const keep = new Set<number>();
  for (const bucket of buckets.values()) {
    const canonicalId = accountGroup.get(bucket[0].transaction.accountId)!;
    const byAccount = new Map<string, Array<{index: number; transaction: T}>>();
    for (const entry of bucket) {
      const list = byAccount.get(entry.transaction.accountId) ?? [];
      list.push(entry);
      byAccount.set(entry.transaction.accountId, list);
    }
    const keepCount = Math.max(...[...byAccount.values()].map(list => list.length));
    const ordered = [...bucket].sort((a, b) =>
      Number(b.transaction.accountId === canonicalId) - Number(a.transaction.accountId === canonicalId)
      || String(a.transaction.id ?? '').localeCompare(String(b.transaction.id ?? ''))
      || a.index - b.index
    );
    for (const entry of ordered.slice(0, keepCount)) keep.add(entry.index);
  }

  return transactions.filter((_, index) => !groupedIndexes.has(index) || keep.has(index));
}
