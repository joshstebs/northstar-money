import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
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
const payroll = load('../lib/finance/payroll.ts', {'./planning': planning, 'node:crypto': crypto});
const thisMonth = new Date();
const date = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth(), 8, 12));
const lastMonth = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - 1, 8, 12));
const selectedMonth = date.toISOString().slice(0, 7);
const cad = {currency: 'CAD', type: 'depository'};
const credit = {currency: 'CAD', type: 'credit'};
const usd = {currency: 'USD', type: 'depository'};

function reportFor(rows, budgetRows = [], accountRows = [{id: 'bank', currency: 'CAD'}]) {
  const db = {
    transaction: {findMany: async () => rows},
    budget: {findMany: async () => budgetRows.map(row => ({month: date, ...row}))},
    account: {findMany: async () => accountRows},
    incomeSource: {findMany: async () => []}, user: {findUnique: async () => null}
  };
  const {spendingInsights} = load('../lib/finance/spending-insights.ts', {
    '@/lib/db': {db}, './planning': planning, './classify': classify, './payroll': payroll
  });
  return spendingInsights(selectedMonth);
}

test('insights count income, expenses, and normalized budgets with net refunds and without counting transfers or card payments', async () => {
  const rows = [
    {date, amount: -100, category: 'FOOD_AND_DRINK', merchantName: 'Grocer', description: 'Grocer', account: cad},
    {date, amount: -45, category: 'food and drink', merchantName: 'Market', description: 'Market', account: cad},
    {date, amount: 2500, category: 'INCOME', merchantName: 'Paycheque', description: 'Paycheque', account: cad},
    {date, amount: -600, category: 'INTERNAL_TRANSFER', merchantName: 'Bank transfer', description: 'Bank transfer', account: cad},
    {date, amount: 15, category: 'FOOD_AND_DRINK', merchantName: 'Grocer', description: 'Card refund', account: credit},
    {date, amount: -25, category: 'TRANSFER_OUT', merchantName: 'Rent e-transfer', description: 'Rent', account: cad},
    {date, amount: -40, category: 'OTHER', merchantName: 'US store', description: 'US store', account: usd},
    {date: lastMonth, amount: -80, category: 'FOOD_AND_DRINK', merchantName: 'Previous', description: 'Previous', account: cad}
  ];
  const r = await reportFor(rows, [{id: 'budget', category: 'FOOD_AND_DRINK', amount: 200}]);
  assert.equal(r.income, 2500);
  assert.equal(r.spending, 155);
  assert.equal(r.net, 2345);
  assert.equal(r.savingsRate, 94);
  assert.equal(r.excludedTransfers, 1);
  assert.equal(r.excludedForeignCurrency, 1);
  assert.equal(r.spendingByCategory[0].name, 'Food And Drink');
  assert.equal(r.budgetItems[0].used, 130);
  assert.equal(r.budgetItems[0].remaining, 70);
  assert.equal(r.budgetItems[0].percentage, 65);
  assert.equal(r.monthlyTrend.at(-2).spending, 80);
  assert.equal(r.monthlyTrend.at(-1).spending, 155);
  assert.equal(r.merchants[0].name, 'Grocer');
});

test('empty account data produces no invented values and no savings rate', async () => {
  const r = await reportFor([], [], []);
  assert.equal(r.hasAccounts, false);
  assert.equal(r.hasTransactions, false);
  assert.equal(r.income, 0);
  assert.equal(r.spending, 0);
  assert.equal(r.savingsRate, null);
  assert.equal(r.projectedSpending, null);
});

test('zero budget limits, spending over limit and missing income are handled', async () => {
  const r = await reportFor([
    {date, amount: -20, category: 'SHOPPING', merchantName: 'Shop', description: 'Shop', account: cad}
  ], [{id: 'zero', category: 'shopping', amount: 0}]);
  assert.equal(r.budgetItems[0].percentage, 100);
  assert.equal(r.budgetItems[0].remaining, -20);
  assert.equal(r.savingsRate, null);
  assert.equal(r.spending, 20);
});

test('insights surface consistent recurring bills and data-derived savings opportunities', async () => {
  const daysAgo = months => new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - months, 8, 12));
  const rows = [];
  for (const months of [0, 1, 2]) {
    rows.push({date: daysAgo(months), amount: -15.99, category: 'ENTERTAINMENT', merchantName: 'Streaming Co', description: 'Streaming Co', account: cad});
  }
  for (const months of [0, 1, 2]) {
    rows.push({date: daysAgo(months), amount: months === 0 ? -300 : -100, category: 'FOOD_AND_DRINK', merchantName: `Grocer ${months}`, description: 'Grocer', account: cad});
  }
  const r = await reportFor(rows);
  const streaming = r.recurring.find(item => item.merchant === 'Streaming Co');
  assert(streaming, 'recurring subscription should be detected');
  assert.equal(streaming.cadence, 'Monthly');
  assert.equal(streaming.average, 15.99);
  assert.match(streaming.next, /^\d{4}-\d{2}-\d{2}$/);
  const food = r.savingsOpportunities.find(item => item.name === 'Food And Drink');
  assert(food, 'category above baseline should produce an opportunity');
  assert.equal(food.baseline, 100);
  assert.equal(food.possibleSavings, 190);
  assert.equal(r.potentialSavingsTotal, 190);
});

test('insights do not invent recurring bills from too little history', async () => {
  const r = await reportFor([
    {date, amount: -15.99, category: 'ENTERTAINMENT', merchantName: 'One-off', description: 'One-off', account: cad},
    {date: lastMonth, amount: -15.99, category: 'ENTERTAINMENT', merchantName: 'One-off', description: 'One-off', account: cad}
  ]);
  assert.equal(r.recurring.length, 0);
  assert.equal(r.savingsOpportunities.length, 0);
  assert.equal(r.potentialSavingsTotal, 0);
});
