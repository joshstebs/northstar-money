// Run after npm run build. Uses dummy auth and an unreachable database, never live data.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {spawn} from 'node:child_process';
const port = 4387, origin = `http://127.0.0.1:${port}`, secret = 'local-planning-http-test-only';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  env: {...process.env, APP_URL: origin, APP_AUTH_SECRET: secret, APP_AUTH_PASSWORD_HASH: 'local-test-configured', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test'},
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', data => {output += data;});
server.stderr.on('data', data => {output += data;});
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {await fetch(`${origin}/login`); ready = true; break;} catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, output);
  const payload = Buffer.from(JSON.stringify({sub: 'owner', exp: Date.now() + 60000})).toString('base64url');
  const token = `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
  const post = (body, cookie = token, requestOrigin = origin) => fetch(`${origin}/api/planning`, {method: 'POST', headers: {'content-type': 'application/json', origin: requestOrigin, ...(cookie ? {cookie: `northstar_session=${cookie}`} : {})}, body: JSON.stringify(body)});
  assert.equal((await post({kind: 'budget'}, '')).status, 401);
  assert.equal((await post({kind: 'budget'}, token, 'https://untrusted.invalid')).status, 403);
  for (const body of [null, {kind: 'budget', category: 'Food', amount: null}, {kind: 'budget', category: 'Food', amount: 100, month: '2026-13'}, {kind: 'goal', name: 'Goal', targetAmount: 100, targetDate: '2026-02-29'}, {kind: 'debt-terms', accountId: 'card', apr: 101}]) {
    const response = await post(body);
    assert.equal(response.status, 400, await response.text());
  }
  console.log('HTTP checks passed: unsigned 401, cross-origin 403, authenticated invalid inputs 400 before database access.');
} finally {
  server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve));
}
