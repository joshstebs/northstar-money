import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import ts from 'typescript';
function load(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports: {}};
  new Function('require', 'module', 'exports', code)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const planning = load('../lib/finance/planning.ts');
const {parsePlanningInput: parse, normalizeCategory} = planning;
const budget = {kind: 'budget', category: 'FOOD_AND_DRINK', amount: '250', month: '2026-10'};
test('valid planning forms retain stored categories and optional clearing', () => {
  assert.equal(parse(budget).category, 'FOOD_AND_DRINK');
  assert.equal(parse(budget).amount, 250);
  assert.equal(parse(budget).month.toISOString(), '2026-10-01T00:00:00.000Z');
  const goal = parse({kind: 'goal', name: 'College', targetAmount: '100', currentAmount: '', targetDate: '2028-02-29'});
  assert.equal(goal.currentAmount, 0);
  assert.equal(goal.targetDate.toISOString(), '2028-02-29T12:00:00.000Z');
  assert.equal(parse({kind: 'debt-terms', accountId: 'card', apr: '', minimumPayment: null}).apr, null);
  assert.equal(parse({kind: 'debt-terms', accountId: 'card', apr: '0', minimumPayment: '0'}).apr, 0);
});
test('invalid amounts are rejected instead of coerced into zero', () => {
  for (const amount of [null, true, false, '', ' ', -1, '-2', Infinity, NaN, 'Infinity', {}, []]) assert.throws(() => parse({...budget, amount}));
  assert.throws(() => parse({kind: 'goal', name: 'Goal', targetAmount: 100, currentAmount: -1}));
  for (const apr of [-1, 101, true, 'NaN']) assert.throws(() => parse({kind: 'debt-terms', accountId: 'card', apr}));
});
test('rolled dates and malformed months are rejected', () => {
  for (const month of ['0000-01', '2026-13', '2026-00', '2026-1', true]) assert.throws(() => parse({...budget, month}));
  for (const targetDate of ['0000-01-01', '2026-02-29', '2026-04-31', '2026-13-01', 'next week', true]) assert.throws(() => parse({kind: 'goal', name: 'Goal', targetAmount: 100, targetDate}));
  assert.throws(() => parse(null));
  assert.throws(() => parse({kind: 'unknown'}));
});
test('provider category spellings match without rewriting stored values', () => {
  for (const value of ['FOOD_AND_DRINK', 'food and drink', '  Food__AND  Drink ', '_Food__AND Drink_']) assert.equal(normalizeCategory(value), 'FOOD AND DRINK');
});
test('financial snapshot counts matching transactions against existing underscore budget', async () => {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const account = {currency: 'CAD', type: 'depository'};
  const transactions = [
    {category: 'FOOD_AND_DRINK', amount: -25, date: now, account, pending: false},
    {category: 'food and drink', amount: -15, date: now, account, pending: false},
    {category: 'Food_and_Drink', amount: -100, date: now, account, pending: true},
    {category: 'FOOD_AND_DRINK', amount: 200, date: now, account, pending: false},
  ];
  const db = {
    account: {findMany: async () => []}, transaction: {findMany: async () => transactions},
    budget: {findMany: async () => [{id: 'b', category: 'FOOD_AND_DRINK', amount: 100, month}]},
    goal: {findMany: async () => []}, insight: {findMany: async () => []},
  };
  const classify = load('../lib/finance/classify.ts', {'./planning': planning});
  const payroll = load('../lib/finance/payroll.ts', {'./planning': planning, 'node:crypto': crypto});
  const {financialSnapshot} = load('../lib/finance/analytics.ts', {'@/lib/db': {db}, './planning': planning, './classify': classify, './payroll': payroll});
  const result = await financialSnapshot();
  assert.equal(result.budgets[0].category, 'FOOD_AND_DRINK');
  assert.equal(result.budgets[0].spent, 40);
  assert.equal(result.budgets[0].remaining, 60);
  assert.equal(result.budgets[0].percent, 40);
});

test('cleared month and goal id retain optional form semantics', () => {
  const now = new Date('2026-10-13T12:00:00.000Z');
  for (const month of [undefined, null, '']) assert.equal(parse({...budget, month}, now).month.toISOString(), '2026-10-01T00:00:00.000Z');
  for (const id of [undefined, null, '']) assert.equal(parse({kind: 'goal', name: 'Goal', targetAmount: 100, id}).id, undefined);
  for (const id of [true, false, 12, {}, [], ' ']) assert.throws(() => parse({kind: 'goal', name: 'Goal', targetAmount: 100, id}));
});
