import assert from 'node:assert/strict';
import {test} from 'node:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';

function load(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports: {}};
  new Function('require', 'module', 'exports', output)(name => { throw new Error(`Unexpected dependency ${name}`); }, module, module.exports);
  return module.exports;
}

const {consumeLoginAttempt, clearLoginAttempts} = load('../lib/security/rate-limit.ts');

test('login attempts are bounded per client and recover after the window', () => {
  const key = `client-${Math.random()}`;
  const now = Date.now();
  for (let i = 0; i < 20; i++) assert.equal(consumeLoginAttempt(key, now).allowed, true);
  const blocked = consumeLoginAttempt(key, now);
  assert.equal(blocked.allowed, false);
  assert(blocked.retryAfterSeconds > 0);
  assert.equal(consumeLoginAttempt(key, now + 16 * 60_000).allowed, true);
  clearLoginAttempts(key);
  assert.equal(consumeLoginAttempt(key, now + 16 * 60_000).allowed, true);
});
