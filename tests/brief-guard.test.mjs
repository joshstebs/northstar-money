import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/finance/brief-parser.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
const module = {exports: {}};
new Function('require', 'module', 'exports', output)(() => { throw new Error('unexpected dependency'); }, module, module.exports);
const {parseFinancialBrief} = module.exports;

test('brief parser never surfaces prose wrapped around truncated or embedded JSON', () => {
  for (const raw of [
    'Here is your weekly brief: {"brief":"You spent $1,200","actions":["Rev',
    JSON.stringify({brief: 'Good week. {"debug":true}'}),
    JSON.stringify({brief: 'Summary {\\"spent\\": 12}'}),
    'Weekly summary:\n```json\n{"brief":"cut off'
  ]) assert.equal(parseFinancialBrief(raw), null, raw);
  assert.equal(parseFinancialBrief('Here is your brief: {"brief":"Spending held steady.","actions":[]}').brief, 'Spending held steady.');
  assert.equal(parseFinancialBrief('Groceries {about 40%} and dining led spending.').brief, 'Groceries {about 40%} and dining led spending.');
});
