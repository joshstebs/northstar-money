import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports: {}};
  new Function('require', 'module', 'exports', output)(name => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, module, module.exports);
  return module.exports;
}

const Prisma = {Prisma: {TransactionIsolationLevel: {Serializable: 'Serializable'}}};
const account = {account_id: 'provider-account-1', name: 'Chequing', official_name: null, mask: '1234', type: 'depository', subtype: 'checking', balances: {current: 100, available: 100, iso_currency_code: 'CAD'}};

function harness({claim = true, pages = [], accounts = [account], failure = null} = {}) {
  const calls = {accountUpserts: [], transactionUpserts: [], deletes: [], connectionUpdate: null, failureUpdate: null, audit: []};
  const tx = {
    connection: {updateMany: async args => { calls.connectionUpdate = args; return {count: claim ? 1 : 0}; }},
    account: {
      findFirst: async () => null,
      upsert: async args => { calls.accountUpserts.push(args); return {id: `account-${args.where.providerAccountId_connectionId.providerAccountId}`}; }
    },
    transaction: {
      upsert: async args => { calls.transactionUpserts.push(args); return {}; },
      deleteMany: async args => { calls.deletes.push(args); return {count: 1}; }
    },
    auditLog: {create: async args => { calls.audit.push(args); return {}; }}
  };
  const db = {
    connection: {
      findUnique: async () => ({id: 'conn-1', provider: 'plaid', encryptedAccessToken: 'encrypted', cursor: 'cursor-0', updatedAt: new Date('2026-11-01T00:00:00Z'), userId: 'owner'}),
      updateMany: async args => { calls.failureUpdate = args; return {count: 1}; }
    },
    $transaction: async fn => fn(tx)
  };
  const queue = [...pages];
  const client = {
    accountsGet: async () => { if (failure) throw failure; return {data: {accounts}}; },
    transactionsSync: async () => ({data: queue.shift()})
  };
  const module = load('../lib/finance/sync-plaid.ts', {
    '@prisma/client': Prisma,
    '@/lib/db': {db},
    '@/lib/security/crypto': {decryptSecret: () => 'secret-access-token'},
    '@/lib/providers/plaid': {plaidClient: () => client}
  });
  return {sync: module.syncPlaidConnection, calls};
}

const transaction = extra => ({account_id: 'provider-account-1', transaction_id: 'txn-1', name: 'Coffee', merchant_name: 'Cafe', amount: 4.5, date: '2026-11-01', pending: false, iso_currency_code: 'CAD', ...extra});
const page = extra => ({added: [], modified: [], removed: [], next_cursor: 'cursor-1', has_more: false, ...extra});

test('Plaid sync upserts transactions by account and provider id to prevent duplicates', async () => {
  const {sync, calls} = harness({pages: [page({added: [transaction()]})]});
  const result = await sync('conn-1');
  assert.deepEqual(result, {added: 1, modified: 0, removed: 0, accounts: 1});
  assert.deepEqual(calls.accountUpserts[0].where, {providerAccountId_connectionId: {providerAccountId: 'provider-account-1', connectionId: 'conn-1'}});
  assert.deepEqual(calls.transactionUpserts[0].where, {accountId_providerTransactionId: {accountId: 'account-provider-account-1', providerTransactionId: 'txn-1'}});
  assert.equal(calls.transactionUpserts[0].update.pending, false);
  assert.equal(calls.transactionUpserts[0].create.amount, -4.5);
  assert.equal(calls.connectionUpdate.data.cursor, 'cursor-1');
  assert.equal(calls.connectionUpdate.data.status, 'active');
  assert.equal(calls.audit[0].data.action, 'sync_complete');
});

test('Plaid sync skips writes when a concurrent sync claimed the connection', async () => {
  const {sync, calls} = harness({claim: false, pages: [page({added: [transaction()]})]});
  const result = await sync('conn-1');
  assert.deepEqual(result, {added: 0, modified: 0, removed: 0, accounts: 0, skipped: 'A newer sync completed.'});
  assert.equal(calls.transactionUpserts.length, 0);
});

test('Plaid sync removes deleted transactions and superseded pending duplicates', async () => {
  const {sync, calls} = harness({pages: [page({
    added: [transaction({transaction_id: 'posted-1', pending: false, pending_transaction_id: 'pending-1'})],
    removed: [{transaction_id: 'deleted-1'}]
  })]});
  await sync('conn-1');
  assert.deepEqual(calls.deletes[0].where, {account: {connectionId: 'conn-1'}, providerTransactionId: {in: ['deleted-1']}});
  assert.deepEqual(calls.deletes[1].where, {account: {connectionId: 'conn-1'}, pending: true, providerTransactionId: {in: ['pending-1']}});
});

test('Plaid sync marks attention on provider failure without leaking the access token', async () => {
  const {sync, calls} = harness({failure: {response: {data: {error_code: 'ITEM_LOGIN_REQUIRED'}}}});
  await assert.rejects(sync('conn-1'), /Plaid sync needs attention \(ITEM_LOGIN_REQUIRED\)/);
  assert.equal(calls.failureUpdate.data.status, 'attention');
  assert.equal(calls.failureUpdate.data.lastError, 'Plaid sync needs attention (ITEM_LOGIN_REQUIRED).');
  assert(!JSON.stringify(calls.failureUpdate).includes('secret-access-token'));
});

function plaidModule({keyId = 'kid-1', getKey} = {}) {
  const {privateKey, publicKey} = crypto.generateKeyPairSync('ec', {namedCurve: 'P-256'});
  const jwk = {...publicKey.export({format: 'jwk'}), kid: keyId, alg: 'ES256', use: 'sig'};
  const fetched = [];
  const plaid = {
    Configuration: class { constructor(options) { this.options = options; } },
    PlaidApi: class {
      constructor(configuration) { this.configuration = configuration; }
      async webhookVerificationKeyGet({key_id}) { fetched.push(key_id); return {data: {key: getKey ? getKey(key_id) : jwk}}; }
    },
    PlaidEnvironments: {sandbox: {}, production: {}, development: {}},
    Products: {Transactions: 'transactions'},
    CountryCode: {Ca: 'CA'}
  };
  return {module: load('../lib/providers/plaid.ts', {plaid, 'node:crypto': crypto}), privateKey, jwk, fetched};
}

function signedJwt(privateKey, body, {keyId = 'kid-1', iat = Math.floor(Date.now() / 1000), alg = 'ES256'} = {}) {
  const header = Buffer.from(JSON.stringify({alg, kid: keyId})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({iat, request_body_sha256: crypto.createHash('sha256').update(body).digest('hex')})).toString('base64url');
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), {key: privateKey, dsaEncoding: 'ieee-p1363'}).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

test('Plaid webhooks require a valid ES256 signature, freshness and body hash', async () => {
  const old = {...process.env};
  try {
    process.env.PLAID_CLIENT_ID = 'client-id';
    process.env.PLAID_SECRET = 'client-secret';
    const {module, privateKey, fetched} = plaidModule();
    const body = JSON.stringify({webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'item-1'});
    const jwt = signedJwt(privateKey, body);
    assert.equal(await module.verifyPlaidWebhook(body, jwt), true);
    assert.equal(await module.verifyPlaidWebhook(body, jwt), true, 'verification key should be cached');
    assert.equal(fetched.length, 1);
    assert.equal(await module.verifyPlaidWebhook(body.replace('item-1', 'item-2'), jwt), false, 'tampered body must fail');
    assert.equal(await module.verifyPlaidWebhook(body, signedJwt(privateKey, body, {iat: Math.floor(Date.now() / 1000) - 600})), false, 'stale token must fail');
    assert.equal(await module.verifyPlaidWebhook(body, signedJwt(privateKey, body, {alg: 'HS256'})), false, 'wrong algorithm must fail');
    assert.equal(await module.verifyPlaidWebhook(body, null), false);
    assert.equal(await module.verifyPlaidWebhook(body, 'not-a-jwt'), false);
  } finally {
    process.env = old;
  }
});

test('Plaid webhooks fail closed when the verification key is rejected', async () => {
  const old = {...process.env};
  try {
    process.env.PLAID_CLIENT_ID = 'client-id';
    process.env.PLAID_SECRET = 'client-secret';
    const {module, privateKey} = plaidModule({getKey: () => ({kty: 'oct', kid: 'kid-1', alg: 'HS256'})});
    const body = JSON.stringify({webhook_type: 'TRANSACTIONS', item_id: 'item-1'});
    assert.equal(await module.verifyPlaidWebhook(body, signedJwt(privateKey, body)), false);
    process.env.PLAID_SECRET = '';
    assert.equal(await module.verifyPlaidWebhook(body, signedJwt(privateKey, body)), false);
  } finally {
    process.env = old;
  }
});
