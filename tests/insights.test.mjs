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

const {normalizeCategory} = load('../lib/finance/planning.ts');
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
    budget: {findMany: async () => budgetRows},
    account: {findMany: async () => accountRows}
  };
  const {spendingInsights} = load('../lib/finance/spending-insights.ts', {
    '@/lib/db': {db}, '@/lib/finance/planning': {normalizeCategory}
  });
  return spendingInsights(selectedMonth);
}

test('insights count income, expenses, and normalized budgets without counting transfers and credit-card refunds', async () => {
  const rows = [
    {date, amount: -100, category: 'FOOD_AND_DRINK', merchantName: 'Grocer', description: 'Grocer', account: cad},
    {date, amount: -45, category: 'food and drink', merchantName: 'Market', description: 'Market', account: cad},
    {date, amount: 2500, category: 'INCOME', merchantName: 'Paycheque', description: 'Paycheque', account: cad},
    {date, amount: -600, category: 'TRANSFER_OUT', merchantName: 'Bank transfer', description: 'Bank transfer', account: cad},
    {date, amount: 300, category: 'OTHER', merchantName: 'Card refund', description: 'Card refund', account: credit},
    {date, amount: -40, category: 'OTHER', merchantName: 'US store', description: 'US store', account: usd},
    {date: lastMonth, amount: -80, category: 'FOOD_AND_DRINK', merchantName: 'Previous', description: 'Previous', account: cad}
  ];
  const r = await reportFor(rows, [{id: 'budget', category: 'FOOD_AND_DRINK', amount: 200}]);
  assert.equal(r.income, 2500);
  assert.equal(r.spending, 145);
  assert.equal(r.net, 2355);
  assert.equal(r.savingsRate, 94);
  assert.equal(r.excludedTransfers, 1);
  assert.equal(r.excludedForeignCurrency, 1);
  assert.equal(r.spendingByCategory[0].name, 'Food And Drink');
  assert.equal(r.budgetItems[0].used, 145);
  assert.equal(r.budgetItems[0].remaining, 55);
  assert.equal(r.budgetItems[0].percentage, 73);
  assert.equal(r.monthlyTrend.at(-2).spending, 80);
  assert.equal(r.monthlyTrend.at(-1).spending, 145);
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
