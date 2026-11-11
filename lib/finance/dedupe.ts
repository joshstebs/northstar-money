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
  userCategory?: string | null;
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

const MERCHANT_NOISE = new Set([
  'purchase', 'pur', 'pos', 'debit', 'credit', 'card', 'payment', 'pmt', 'online',
  'store', 'shop', 'canada', 'cad', 'inc', 'ltd', 'corp', 'co', 'the', 'and',
  'visa', 'mastercard', 'amex', 'interac'
]);

const toCents = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed * 100);
  return Number.isSafeInteger(rounded) ? rounded : null;
};

const normalizeText = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normalizeProvider = (account: DedupeAccount) => String(account.connection?.provider ?? '').trim().toLowerCase();
const maskOf = (account: DedupeAccount) => {
  const value = String(account.mask ?? '').trim();
  return /^\d{4}$/.test(value) ? value : null;
};
const currencyOf = (account: DedupeAccount) => String(account.currency ?? '').trim().toUpperCase();
const timeOf = (value?: Date | string | null) => {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

function tokensOf(value: unknown, stopwords?: Set<string>) {
  return normalizeText(value).split(' ').filter(token => token && !stopwords?.has(token));
}

// Both token sets must describe the same thing: equal, or one fully contained in the other.
// This avoids confirming distinct products that merely share a word (e.g. Everyday Chequing
// vs Everyday Savings).
function tokenMatch(left: string[], right: string[]) {
  if (!left.length || !right.length) return null;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return [...leftSet].every(token => rightSet.has(token)) || [...rightSet].every(token => leftSet.has(token));
}

export function institutionTokens(name?: string | null) {
  return tokensOf(name, INSTITUTION_STOPWORDS);
}

export function accountNameTokens(name?: string | null) {
  return tokensOf(name, ACCOUNT_NAME_STOPWORDS);
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

// Prefer an account whose balance can actually be counted, then a connected one, newest sync,
// the most transaction history, and finally a stable provider/id order. Never drop the only
// usable balance in favour of a newer but empty duplicate.
function compareAccounts(left: DedupeAccount, right: DedupeAccount) {
  const usable = Number(toCents(right.currentBalance) !== null) - Number(toCents(left.currentBalance) !== null);
  if (usable) return usable;
  const active = Number(right.connection?.status === 'active') - Number(left.connection?.status === 'active');
  if (active) return active;
  const fresh = timeOf(right.connection?.lastSyncedAt) - timeOf(left.connection?.lastSyncedAt);
  if (fresh) return fresh;
  const count = (account: DedupeAccount) => {
    const value = Number(account._count?.transactions ?? 0);
    return Number.isFinite(value) ? Math.min(value, 1_000_000) : 0;
  };
  const transactions = count(right) - count(left);
  if (transactions) return transactions;
  const provider = providerRank(normalizeProvider(right)) - providerRank(normalizeProvider(left));
  if (provider) return provider;
  return left.id.localeCompare(right.id);
}

type Pair = {confirmed: boolean; reason: string};

/**
 * Evaluates whether two accounts can describe the same real account. Identity is confirmed only
 * when both belong to the same user, come from different providers, and their mask, currency,
 * known account type, institution and account name all agree. A missing signal downgrades the
 * pair to a possible duplicate; outright conflicting institution or name is treated as distinct
 * accounts. Balances are never used to establish identity.
 */
function evaluatePair(left: DedupeAccount, right: DedupeAccount): Pair | null {
  if (left.id === right.id || left.connectionId === right.connectionId) return null;
  if (!left.userId || left.userId !== right.userId) return null;
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

  const leftProvider = normalizeProvider(left);
  const rightProvider = normalizeProvider(right);
  const crossProvider = Boolean(leftProvider && rightProvider && leftProvider !== rightProvider);
  const typesKnown = leftKind !== 'unknown' && rightKind !== 'unknown' && leftKind === rightKind;

  if (institutions === true && names === true && crossProvider && typesKnown) {
    return {confirmed: true, reason: 'Matching institution, account name, mask, currency and type across providers'};
  }
  const reason = !crossProvider
    ? 'Linked through the same provider; identity cannot be confirmed'
    : !typesKnown
      ? 'Account type is missing or ambiguous; identity cannot be confirmed'
      : institutions !== true
        ? 'Institution name is missing or differs; identity cannot be confirmed'
        : 'Account name is missing or differs; identity cannot be confirmed';
  return {confirmed: false, reason};
}

const accountPairKey = (left: string, right: string) => left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;

/**
 * Groups accounts that may represent the same real account. Only pairs from the same user, with
 * the same four-digit mask and currency, are compared. A confirmed group is a clique: every
 * member is directly confirmed against every other member, so transitive name/institution
 * differences cannot silently pull in an unconfirmed account. Possible duplicates are left
 * untouched and reported for review. This function never mutates or deletes stored accounts.
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

  const confirmedPairs = new Set(edges.filter(edge => edge.pair.confirmed).map(edge => accountPairKey(edge.a, edge.b)));
  const groupOf = new Map<string, Set<string>>();
  const groups: Array<Set<string>> = [];
  const canJoin = (group: Set<string>, id: string) => [...group].every(member => confirmedPairs.has(accountPairKey(member, id)));
  const canMerge = (left: Set<string>, right: Set<string>) =>
    [...left].every(a => [...right].every(b => confirmedPairs.has(accountPairKey(a, b))));

  for (const edge of edges) {
    if (!edge.pair.confirmed) continue;
    const leftGroup = groupOf.get(edge.a);
    const rightGroup = groupOf.get(edge.b);
    if (!leftGroup && !rightGroup) {
      const group = new Set([edge.a, edge.b]);
      groups.push(group);
      groupOf.set(edge.a, group);
      groupOf.set(edge.b, group);
    } else if (leftGroup && !rightGroup) {
      if (canJoin(leftGroup, edge.b)) {
        leftGroup.add(edge.b);
        groupOf.set(edge.b, leftGroup);
      }
    } else if (!leftGroup && rightGroup) {
      if (canJoin(rightGroup, edge.a)) {
        rightGroup.add(edge.a);
        groupOf.set(edge.a, rightGroup);
      }
    } else if (leftGroup && rightGroup && leftGroup !== rightGroup) {
      if (canMerge(leftGroup, rightGroup)) {
        for (const id of rightGroup) {
          leftGroup.add(id);
          groupOf.set(id, leftGroup);
        }
      }
    }
  }

  const accountById = new Map(candidates.map(account => [account.id, account]));
  const confirmed: DuplicateGroup[] = [];
  const accountRoot = new Map<string, string>();
  for (const members of groups) {
    const cluster = [...members].map(id => accountById.get(id)).filter((account): account is DedupeAccount => Boolean(account));
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
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    let root = id;
    while (root !== parent.get(root)) root = parent.get(root)!;
    while (id !== root) {
      const next = parent.get(id)!;
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  for (const edge of possibleEdges) {
    const left = find(edge.a);
    const right = find(edge.b);
    if (left !== right) parent.set(left, right);
  }
  const possibleClusters = new Map<string, {ids: Set<string>; reasons: Set<string>}>();
  for (const edge of possibleEdges) {
    const root = find(edge.a);
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

type Merchant = {text: string; tokens: string[] | null};

function merchantOf(transaction: DedupeTransaction): Merchant {
  const text = normalizeText(transaction.merchantName || transaction.description);
  const tokens = text.split(' ').filter(token => token && !MERCHANT_NOISE.has(token) && !/^\d+$/.test(token));
  return {text, tokens: tokens.length ? tokens : null};
}

// Plaid stores a clean merchant name while Flinks/statement imports store raw descriptions such
// as "PURCHASE - TIM HORTONS #4412". Compare meaningful tokens (numbers and card noise removed)
// and require one token set to contain the other.
function sameMerchant(left: Merchant, right: Merchant) {
  if (left.tokens === null || right.tokens === null) return Boolean(left.text) && left.text === right.text;
  const leftSet = new Set(left.tokens);
  const rightSet = new Set(right.tokens);
  return [...leftSet].every(token => rightSet.has(token)) || [...rightSet].every(token => leftSet.has(token));
}

/**
 * Removes transactions duplicated across accounts in a confirmed duplicate group while keeping
 * legitimate repeats: for a given day/amount/pending-state/merchant cluster it keeps as many
 * copies as the provider that reported the most. Rows with the user's own category are preferred
 * when a copy must be dropped. Transactions outside a confirmed group are never compared.
 * This only filters in-memory rows for reporting.
 */
export function dedupeTransactions<T extends DedupeTransaction>(transactions: T[], duplicateToCanonical: Map<string, string>): T[] {
  if (!duplicateToCanonical.size) return transactions;

  const accountGroup = new Map<string, string>();
  for (const [duplicateId, canonicalId] of duplicateToCanonical) {
    accountGroup.set(duplicateId, canonicalId);
    accountGroup.set(canonicalId, canonicalId);
  }

  type Entry = {index: number; transaction: T; merchant: Merchant};
  const buckets = new Map<string, Entry[]>();
  const groupedIndexes = new Set<number>();
  transactions.forEach((transaction, index) => {
    const canonicalId = accountGroup.get(transaction.accountId);
    if (!canonicalId) return;
    const cents = toCents(transaction.amount);
    if (cents === null) return;
    const state = transaction.pending ? 'pending' : 'posted';
    const key = `${canonicalId}\u0000${dayKey(transaction.date)}\u0000${cents}\u0000${state}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push({index, transaction, merchant: merchantOf(transaction)});
    buckets.set(key, bucket);
    groupedIndexes.add(index);
  });

  const keep = new Set<number>();
  for (const bucket of buckets.values()) {
    const canonicalId = accountGroup.get(bucket[0].transaction.accountId)!;
    // Greedy cluster against the cluster representative so non-transitive token containment
    // cannot chain unrelated merchants together.
    const clusters: Entry[][] = [];
    for (const entry of bucket) {
      const cluster = clusters.find(candidate => sameMerchant(candidate[0].merchant, entry.merchant));
      if (cluster) cluster.push(entry);
      else clusters.push([entry]);
    }

    for (const cluster of clusters) {
      const byAccount = new Map<string, Entry[]>();
      for (const entry of cluster) {
        const list = byAccount.get(entry.transaction.accountId) ?? [];
        list.push(entry);
        byAccount.set(entry.transaction.accountId, list);
      }
      const keepCount = Math.max(...[...byAccount.values()].map(list => list.length));
      const ordered = [...cluster].sort((a, b) =>
        Number(Boolean(b.transaction.userCategory)) - Number(Boolean(a.transaction.userCategory))
        || Number(Boolean(a.transaction.pending)) - Number(Boolean(b.transaction.pending))
        || Number(b.transaction.accountId === canonicalId) - Number(a.transaction.accountId === canonicalId)
        || String(a.transaction.id ?? '').localeCompare(String(b.transaction.id ?? ''))
        || a.index - b.index
      );
      for (const entry of ordered.slice(0, keepCount)) keep.add(entry.index);
    }
  }

  return transactions.filter((_, index) => !groupedIndexes.has(index) || keep.has(index));
}
