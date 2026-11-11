import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
  }).outputText;
  const module = {exports: {}};
  new Function('require', 'module', 'exports', code)(name => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

const planning = load('../lib/finance/planning.ts');
const classify = load('../lib/finance/classify.ts', {'./planning': planning});
const {analyzeDuplicateAccounts, duplicateAccountMap, dedupeTransactions, institutionsMatch, accountNamesMatch} =
  load('../lib/finance/dedupe.ts', {'./classify': classify});

const synced = new Date('2026-11-01T00:00:00Z');

function account({
  id, userId = 'owner', connectionId = `${id}-connection`, mask = '1234', name = 'Chequing',
  type = 'depository', subtype = 'checking', currency = 'CAD', currentBalance = 1000,
  institutionName = 'TD Canada Trust', provider = 'plaid', status = 'active', transactions = 0,
  lastSyncedAt = synced
}) {
  return {
    id, userId, connectionId, mask, name, type, subtype, currency, currentBalance,
    _count: {transactions}, connection: {provider, institutionName, status, lastSyncedAt}
  };
}

test('institution and account names match provider spellings but not distinct products', () => {
  assert.equal(institutionsMatch('TD Canada Trust', 'TD'), true);
  assert.equal(institutionsMatch('TD Bank', 'TD Canada Trust'), true);
  assert.equal(institutionsMatch('TD Canada Trust', 'Royal Bank of Canada'), false);
  assert.equal(institutionsMatch(null, 'TD'), null);
  assert.equal(accountNamesMatch('Chequing', 'Chequing'), true);
  assert.equal(accountNamesMatch('Everyday Chequing', 'Chequing'), true);
  assert.equal(accountNamesMatch('Chequing', 'Savings'), false);
  assert.equal(accountNamesMatch('Everyday Chequing', 'Everyday Savings'), false);
  assert.equal(accountNamesMatch(null, 'Chequing'), null);
});

test('confirms the same account linked through Plaid and Flinks and keeps the richer account', () => {
  const analysis = analyzeDuplicateAccounts([
    account({id: 'plaid-account', provider: 'plaid', transactions: 4}),
    account({id: 'flinks-account', connectionId: 'flinks-connection', provider: 'flinks', transactions: 9})
  ]);
  assert.equal(analysis.confirmed.length, 1);
  assert.equal(analysis.confirmed[0].canonicalId, 'flinks-account');
  assert.deepEqual(analysis.confirmed[0].duplicateIds, ['plaid-account']);
  assert.deepEqual([...duplicateAccountMap(analysis.confirmed)], [['plaid-account', 'flinks-account']]);
  assert.equal(analysis.possible.length, 0);
});

test('an unknown account type downgrades a match to possible instead of confirming it', () => {
  const analysis = analyzeDuplicateAccounts([
    account({id: 'known', provider: 'plaid', type: 'depository'}),
    account({id: 'unknown', connectionId: 'flinks-connection', provider: 'flinks', type: 'Operations', subtype: null})
  ]);
  assert.equal(analysis.confirmed.length, 0);
  assert.equal(analysis.possible.length, 1);
  assert.match(analysis.possible[0].reason, /Account type/);
});

test('transitive name differences cannot pull an unconfirmed account into a group', () => {
  const analysis = analyzeDuplicateAccounts([
    account({id: 'a', provider: 'plaid', name: 'Chequing'}),
    account({id: 'b', connectionId: 'flinks-connection', provider: 'flinks', name: 'Everyday Chequing'}),
    account({id: 'c', connectionId: 'statement-connection', provider: 'statement', name: 'Everyday'})
  ]);
  assert.equal(analysis.confirmed.length, 1);
  assert.deepEqual(analysis.confirmed[0].accountIds, ['a', 'b']);
  assert.equal(analysis.confirmed[0].duplicateIds.includes('c'), false);
});

test('preserves two legitimate accounts that share the same last four digits', () => {
  const analysis = analyzeDuplicateAccounts([
    account({id: 'chequing', name: 'Chequing', transactions: 12}),
    account({id: 'savings', name: 'Savings', connectionId: 'savings-connection', provider: 'flinks'})
  ]);
  assert.equal(analysis.confirmed.length, 0);
  assert.equal(analysis.possible.length, 0);
  assert.equal(duplicateAccountMap(analysis.confirmed).size, 0);
});

test('missing institution names downgrade a match to possible and keep both accounts', () => {
  const analysis = analyzeDuplicateAccounts([
    account({id: 'known', provider: 'plaid', institutionName: 'TD Canada Trust'}),
    account({id: 'unknown', connectionId: 'flinks-connection', provider: 'flinks', institutionName: null})
  ]);
  assert.equal(analysis.confirmed.length, 0);
  assert.equal(analysis.possible.length, 1);
  assert.deepEqual(analysis.possible[0].accountIds, ['known', 'unknown']);
  assert.match(analysis.possible[0].reason, /Institution name/);
});

test('missing masks are never treated as identity', () => {
  const analysis = analyzeDuplicateAccounts([
    account({id: 'one', mask: null}),
    account({id: 'two', connectionId: 'two-connection', mask: null, provider: 'flinks'})
  ]);
  assert.equal(analysis.confirmed.length, 0);
  assert.equal(analysis.possible.length, 0);
});

test('does not merge different currencies or incompatible account types', () => {
  assert.equal(analyzeDuplicateAccounts([
    account({id: 'cad', currency: 'CAD'}),
    account({id: 'usd', connectionId: 'usd-connection', currency: 'USD', provider: 'flinks'})
  ]).confirmed.length, 0);
  assert.equal(analyzeDuplicateAccounts([
    account({id: 'chequing', type: 'depository', subtype: 'checking'}),
    account({id: 'card', connectionId: 'card-connection', type: 'credit', subtype: 'credit card', provider: 'flinks'})
  ]).confirmed.length, 0);
});

test('does not confirm duplicates linked through the same provider', () => {
  const analysis = analyzeDuplicateAccounts([
    account({id: 'first', connectionId: 'item-a', provider: 'plaid', transactions: 3}),
    account({id: 'second', connectionId: 'item-b', provider: 'plaid', transactions: 2})
  ]);
  assert.equal(analysis.confirmed.length, 0);
  assert.equal(analysis.possible.length, 1);
  assert.match(analysis.possible[0].reason, /same provider/);
});

test('a similar balance alone never establishes identity', () => {
  const analysis = analyzeDuplicateAccounts([
    account({id: 'left', institutionName: null, name: null, currentBalance: 500}),
    account({id: 'right', connectionId: 'right-connection', provider: 'flinks', institutionName: null, name: null, currentBalance: 500.01})
  ]);
  assert.equal(analysis.confirmed.length, 0);
  assert.equal(analysis.possible.length, 1);
  assert.deepEqual(analysis.possible[0].accountIds, ['left', 'right']);
});

test('the canonical account keeps the only usable balance', () => {
  const analysis = analyzeDuplicateAccounts([
    account({id: 'empty', provider: 'plaid', transactions: 40, currentBalance: null}),
    account({id: 'funded', connectionId: 'flinks-connection', provider: 'flinks', transactions: 1, currentBalance: 5000})
  ]);
  assert.equal(analysis.confirmed.length, 1);
  assert.equal(analysis.confirmed[0].canonicalId, 'funded');
  assert.deepEqual(analysis.confirmed[0].duplicateIds, ['empty']);
});

test('stale balances still match while the canonical account prefers a fresh, connected provider', () => {
  const analysis = analyzeDuplicateAccounts([
    account({id: 'stale', provider: 'plaid', status: 'attention', transactions: 50, currentBalance: 1000, lastSyncedAt: new Date('2026-01-01T00:00:00Z')}),
    account({id: 'fresh', connectionId: 'fresh-connection', provider: 'flinks', status: 'active', transactions: 1, currentBalance: 7600})
  ]);
  assert.equal(analysis.confirmed.length, 1);
  assert.equal(analysis.confirmed[0].canonicalId, 'fresh');
  assert.deepEqual(analysis.confirmed[0].duplicateIds, ['stale']);
});

test('accounts belonging to different or missing users are never compared', () => {
  assert.equal(analyzeDuplicateAccounts([
    account({id: 'owner-account', userId: 'owner'}),
    account({id: 'spouse-account', userId: 'spouse', connectionId: 'spouse-connection', provider: 'flinks'})
  ]).confirmed.length, 0);
  assert.equal(analyzeDuplicateAccounts([
    account({id: 'first', userId: null}),
    account({id: 'second', userId: null, connectionId: 'second-connection', provider: 'flinks'})
  ]).confirmed.length, 0);
});

test('keeps the maximum number of repeated purchases across a duplicate group', () => {
  const map = duplicateAccountMap([{canonicalId: 'canonical', duplicateIds: ['dupe'], accountIds: ['canonical', 'dupe']}]);
  const coffee = (id, accountId) => ({id, accountId, amount: -4.5, date: new Date('2026-11-01T12:00:00Z'), merchantName: 'Cafe', pending: false});
  const rows = [
    coffee('a1', 'canonical'), coffee('a2', 'canonical'),
    coffee('b1', 'dupe'), coffee('b2', 'dupe'),
    {id: 'b3', accountId: 'dupe', amount: -30, date: new Date('2026-11-02T12:00:00Z'), merchantName: 'Grocer', pending: false},
    coffee('c1', 'other-account')
  ];
  const kept = dedupeTransactions(rows, map).map(row => row.id);
  assert.deepEqual(kept.sort(), ['a1', 'a2', 'b3', 'c1']);
});

test('matches raw provider descriptions against clean merchant names', () => {
  const map = duplicateAccountMap([{canonicalId: 'canonical', duplicateIds: ['dupe'], accountIds: ['canonical', 'dupe']}]);
  const date = new Date('2026-11-01T12:00:00Z');
  const rows = [
    {id: 'plaid', accountId: 'canonical', amount: -4.5, date, merchantName: 'Tim Hortons', pending: false},
    {id: 'flinks', accountId: 'dupe', amount: -4.5, date, description: 'PURCHASE - TIM HORTONS #4412', pending: false}
  ];
  const kept = dedupeTransactions(rows, map).map(row => row.id);
  assert.deepEqual(kept, ['plaid']);
});

test('prefers the copy that carries the user category', () => {
  const map = duplicateAccountMap([{canonicalId: 'canonical', duplicateIds: ['dupe'], accountIds: ['canonical', 'dupe']}]);
  const date = new Date('2026-11-01T12:00:00Z');
  const rows = [
    {id: 'plain', accountId: 'canonical', amount: -4.5, date, merchantName: 'Cafe', pending: false},
    {id: 'categorised', accountId: 'dupe', amount: -4.5, date, merchantName: 'Cafe', pending: false, userCategory: 'FOOD_AND_DRINK'}
  ];
  assert.deepEqual(dedupeTransactions(rows, map).map(row => row.id), ['categorised']);
});

test('pending and posted copies are kept separate', () => {
  const map = duplicateAccountMap([{canonicalId: 'canonical', duplicateIds: ['dupe'], accountIds: ['canonical', 'dupe']}]);
  const date = new Date('2026-11-01T12:00:00Z');
  const rows = [
    {id: 'posted', accountId: 'canonical', amount: -4.5, date, merchantName: 'Cafe', pending: false},
    {id: 'pending', accountId: 'dupe', amount: -4.5, date, merchantName: 'Cafe', pending: true}
  ];
  assert.deepEqual(dedupeTransactions(rows, map).map(row => row.id), ['posted', 'pending']);
});

test('duplicated transfers and refunds collapse without merging opposite directions', () => {
  const map = duplicateAccountMap([{canonicalId: 'canonical', duplicateIds: ['dupe'], accountIds: ['canonical', 'dupe']}]);
  const date = new Date('2026-11-01T12:00:00Z');
  const refund = (id, accountId) => ({id, accountId, amount: 50, date, description: 'Merchant refund', pending: false});
  const transfer = (id, accountId, amount = -500) => ({id, accountId, amount, date, description: 'Interac e-Transfer', pending: false});
  const rows = [
    transfer('t1', 'canonical'), refund('r1', 'canonical'),
    transfer('t2', 'dupe'), refund('r2', 'dupe'),
    transfer('incoming', 'dupe', 500)
  ];
  const kept = dedupeTransactions(rows, map).map(row => row.id).sort();
  assert.deepEqual(kept, ['incoming', 'r1', 't1']);
});

test('leaves repeats intact when accounts are not duplicates', () => {
  const rows = [
    {id: 'a1', accountId: 'solo', amount: -4.5, date: new Date('2026-11-01T12:00:00Z'), merchantName: 'Cafe', pending: false},
    {id: 'a2', accountId: 'solo', amount: -4.5, date: new Date('2026-11-01T12:00:00Z'), merchantName: 'Cafe', pending: false}
  ];
  assert.deepEqual(dedupeTransactions(rows, new Map()).map(row => row.id), ['a1', 'a2']);
});

test('analysis and transaction filtering never mutate stored rows', () => {
  const accounts = [
    account({id: 'plaid-account'}),
    account({id: 'flinks-account', connectionId: 'flinks-connection', provider: 'flinks'})
  ];
  const before = JSON.stringify(accounts);
  const analysis = analyzeDuplicateAccounts(accounts);
  assert.equal(JSON.stringify(accounts), before);
  assert.equal(accounts.length, 2);
  assert.equal(analysis.confirmed.length, 1);

  const rows = [
    {id: 'a1', accountId: 'plaid-account', amount: -4.5, date: new Date('2026-11-01T12:00:00Z'), merchantName: 'Cafe', pending: false},
    {id: 'b1', accountId: 'flinks-account', amount: -4.5, date: new Date('2026-11-01T12:00:00Z'), merchantName: 'Cafe', pending: false}
  ];
  const rowsBefore = JSON.stringify(rows);
  assert.equal(dedupeTransactions(rows, duplicateAccountMap(analysis.confirmed)).length, 1);
  assert.equal(JSON.stringify(rows), rowsBefore);
  assert.equal(rows.length, 2);
});
