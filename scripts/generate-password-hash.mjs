import {pbkdf2Sync, randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';

const password = process.argv[2] ?? (process.stdin.isTTY ? '' : readFileSync(0, 'utf8').replace(/\r?\n$/, ''));
if (!password) {
  console.error('Provide the password over standard input.');
  process.exit(1);
}
const iterations = 210000;
const salt = randomBytes(24);
const hash = pbkdf2Sync(password, salt, iterations, 64, 'sha512');
console.log(`pbkdf2-sha512$${iterations}$${salt.toString('base64url')}$${hash.toString('base64url')}`);
