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

const planning = load('../lib/finance/planning.ts');
const classify = load('../lib/finance/classify.ts', {'./planning': planning});
const {budgetStatus, classifyTransaction} = classify;
const {parseFinancialBrief} = load('../lib/finance/brief-parser.ts');
const {availableBrief, bankDataStale} = load('../lib/finance/advice.ts');
const {goalProgress} = load('../lib/finance/goals.ts');
const {balanceTotals} = load('../lib/finance/net-worth.ts', {'@/lib/db': {}, './classify': classify});
const {paymentCadence, payrollSource} = load('../lib/finance/payroll.ts', {'./planning': planning, 'node:crypto': crypto});
const {parseCardStatement} = load('../lib/finance/statement-import.ts', {'node:crypto': crypto});
const auth = load('../lib/security/auth.ts', {'node:crypto': crypto});

test('financial brief supports objects, JSON strings, fenced and double-encoded JSON', () => {
  const fixture = {brief: 'Spend and income both increased.', actions: [{title: 'Review groceries', detail: 'Check the food budget.'}], dataQualityCaveats: ['One account is stale.']};
  const expected = {brief: fixture.brief, actions: ['Review groceries — Check the food budget.'], dataQualityCaveats: fixture.dataQualityCaveats};
  for (const value of [fixture, JSON.stringify(fixture), JSON.stringify(JSON.stringify(fixture)), '```json\n' + JSON.stringify(fixture) + '\n```']) {
    assert.deepEqual(parseFinancialBrief(value), expected);
  }
});

test('financial brief rejects malformed JSON, filters missing fields and retains plain text', () => {
  for (const value of ['{"brief":', '[{"brief":"secret"},{"brief":"second"}]', '{"unknown":"value"}', '{broken', null]) assert.equal(parseFinancialBrief(value), null);
  assert.deepEqual(parseFinancialBrief('[{"brief":"secret"}]'), {brief: 'secret', actions: [], dataQualityCaveats: []});
  assert.deepEqual(parseFinancialBrief({brief: 2, actions: [null, false, 'Review bills']}), {brief: null, actions: ['Review bills'], dataQualityCaveats: []});
  assert.equal(parseFinancialBrief('Review next month’s bills.').brief, 'Review next month’s bills.');
});

test('no-data fallback and expired connections provide caveats', () => {
  const stale = bankDataStale([{status: 'attention', lastSyncedAt: null}, {status: 'manual', lastSyncedAt: null}]);
  assert(stale);
  assert(!bankDataStale([{status: 'manual', lastSyncedAt: null}]));
  const result = availableBrief({hasData: false, stale, accountCount: 0, net: 0, budgetAttention: 0});
  assert.match(result.brief, /once NorthStar has posted activity/);
  assert.equal(result.dataQualityCaveats.length, 2);
});

test('cash flow classification excludes pending, foreign currency, repayments and unknown credits', () => {
  const bank = {type: 'depository', currency: 'CAD'};
  const card = {type: 'credit', currency: 'CAD'};
  const flow = input => classifyTransaction({account: bank, ...input}).type;
  assert.equal(flow({amount: 2200, subcategory: 'INCOME_WAGES'}), 'income');
  assert.equal(flow({amount: 2200, description: 'Payroll'}), 'income');
  assert.equal(flow({amount: 150, description: 'Deposit'}), 'unclassified');
  assert.equal(flow({amount: 150, description: 'Deposit', userCategory: 'Income'}), 'income');
  assert.equal(flow({amount: 100, category: 'TRANSFER_IN', subcategory: 'TRANSFER_IN_ACCOUNT_TRANSFER'}), 'transfer');
  assert.equal(flow({amount: -200, category: 'LOAN_PAYMENTS', subcategory: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'}), 'transfer');
  assert.equal(flow({amount: 200, account: card, description: 'Payment received'}), 'transfer');
  assert.equal(flow({amount: 35, account: card, description: 'Purchase refund'}), 'refund');
  assert.equal(flow({amount: -35, account: card, pending: true}), 'ignore');
  assert.equal(flow({amount: -35, account: card, currency: 'USD'}), 'foreign');
  assert.equal(flow({amount: -35, account: card}), 'spending');
});

test('payroll candidates use description and a consistent deposit cadence', () => {
  const base = {description: 'PAYROLL 20261003', accountId: 'a'};
  assert(payrollSource(base).identified);
  assert.equal(payrollSource(base).key, payrollSource({...base, description: 'PAYROLL 20261017'}).key);
  const dates = ['2026-10-31', '2026-10-17', '2026-10-03'].map(value => new Date(value));
  assert.equal(paymentCadence(dates, [2100, 2100, 2000]).label, 'Every two weeks');
  assert.equal(paymentCadence(dates, [2100, 2100, 900]), null);
});

test('net worth excludes unsupported currency and counts overdrafts and credit balances on the correct side', () => {
  assert.deepEqual(balanceTotals([
    {type: 'depository', currency: 'CAD', currentBalance: 1500},
    {type: 'savings', currency: 'CAD', currentBalance: -25},
    {type: 'credit', currency: 'CAD', currentBalance: 500},
    {type: 'loan', currency: 'CAD', currentBalance: -20},
    {type: 'credit', currency: 'CAD', currentBalance: null},
    {type: 'investment', currency: 'USD', currentBalance: 100}
  ]), {assets: 1520, liabilities: 525, net: 995, counted: 4, excluded: 2});
});

test('budget threshold and projections use underlying amounts and real contributions', () => {
  assert.equal(budgetStatus(79.99, 100), 'On track');
  assert.equal(budgetStatus(80, 100), 'Approaching limit');
  assert.equal(budgetStatus(100, 100), 'Over budget');
  assert.equal(budgetStatus(75, 100, 70), 'Approaching limit');
  assert.equal(budgetStatus(0, 0), 'On track');
  const now = new Date('2026-11-07');
  const target = new Date('2027-05-07');
  assert.equal(goalProgress(200, 800, target, null, now).projection, null);
  assert.equal(goalProgress(200, 800, target, 200, now).status, 'On track');
  assert.equal(goalProgress(200, 800, target, 20, now).status, 'Behind schedule');
  assert.equal(goalProgress(900, 800, target, null, now).remaining, 0);
});

test('statement parser supports quoted CSV, validated signs, repeat IDs and credit-card OFX', () => {
  const csv = 'Transaction Date,Description,Amount\r\n11/07/2026,"Merchant, Inc.",12.50\r\n11/07/2026,"Merchant, Inc.",12.50\r\n11/07/2026,Payment Received,-80';
  const options = {dateFormat: 'mdy', amountMode: 'charges-positive'};
  const first = parseCardStatement(csv, options);
  assert.deepEqual(parseCardStatement(csv, options), first);
  assert.notEqual(first[0].providerTransactionId, first[1].providerTransactionId);
  assert.equal(first[0].amount, -12.5);
  assert.equal(first[2].category, 'INTERNAL TRANSFER');
  assert.throws(() => parseCardStatement(csv, {...options, dateFormat: 'iso'}), /date order/);
  assert.throws(() => parseCardStatement(csv.replace('11/07/2026', '02/30/2026'), options), /valid date/);
  const ofx = '<OFX><CCSTMTRS><CURDEF>CAD<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261107<TRNAMT>-23.41<FITID>1<NAME>Food &amp; Drink</STMTTRN></CCSTMTRS></OFX>';
  const [card] = parseCardStatement(ofx, {});
  assert.equal(card.amount, -23.41);
  assert.equal(card.description, 'Food & Drink');
  assert.throws(() => parseCardStatement(ofx.replace('CAD', 'USD'), {}), /CAD/);
});

test('separate owner and spouse passwords produce expiring, signed household sessions', () => {
  const hash = password => `pbkdf2-sha512$100000$dGVzdA$${crypto.pbkdf2Sync(password, 'test', 100000, 64, 'sha512').toString('base64url')}`;
  const oldEnv = process.env;
  const realNow = Date.now;
  try {
    process.env = {...oldEnv, APP_AUTH_SECRET: 'test-only', APP_AUTH_PASSWORD_HASH: hash('test-owner'), APP_SPOUSE_PASSWORD_HASH: hash('test-spouse')};
    assert.equal(auth.authenticatePassword('test-owner'), 'owner');
    assert.equal(auth.authenticatePassword('test-spouse'), 'spouse');
    assert.equal(auth.authenticatePassword('different'), null);
    const token = auth.createSessionToken('spouse');
    assert(auth.verifySessionToken(token));
    assert(!auth.verifySessionToken(token + '.extra'));
    assert(!auth.verifySessionToken(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')));
    const start = realNow();
    Date.now = () => start + 12 * 60 * 60 * 1000 + 100;
    assert(!auth.verifySessionToken(token));
    Date.now = realNow;
    delete process.env.APP_SPOUSE_PASSWORD_HASH;
    assert(!auth.verifySessionToken(token));
  } finally {process.env = oldEnv; Date.now = realNow;}
});

test('stored weekly brief JSON is never rendered as raw JSON', () => {
  const stored = JSON.stringify({brief: 'Income covered spending this month.', actions: ['Review groceries'], dataQualityCaveats: ['One account is stale.']});
  const parsed = parseFinancialBrief(stored);
  assert.deepEqual(parsed, {brief: 'Income covered spending this month.', actions: ['Review groceries'], dataQualityCaveats: ['One account is stale.']});
  assert.doesNotMatch(parsed.brief, /^[\[{]/);
  for (const raw of [JSON.stringify({brief: '{"spent":120}'}), '{"brief":', '```json\n{"broken":true}\n```', '{"other":1}']) {
    assert.equal(parseFinancialBrief(raw), null);
  }
});

test('brief parser accepts wrapped, aliased and single-item payloads', () => {
  const expected = {brief: 'A cautious summary.', actions: ['Check the food budget.'], dataQualityCaveats: ['A connection needs attention.']};
  const cases = [
    {data: {brief: 'A cautious summary.', recommendedActions: ['Check the food budget.'], warnings: ['A connection needs attention.']}},
    {result: {summary: 'A cautious summary.', recommendations: [{title: 'Check the food budget.'}], caveats: ['A connection needs attention.']}},
    [{financial_brief: {overview: 'A cautious summary.', actions: ['Check the food budget.'], dataQuality: ['A connection needs attention.']}}],
    JSON.stringify({payload: {headline: 'A cautious summary.', actions: ['Check the food budget.'], dataQualityCaveats: ['A connection needs attention.']}})
  ];
  for (const value of cases) assert.deepEqual(parseFinancialBrief(value), expected);
});
