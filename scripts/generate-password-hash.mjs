import {pbkdf2Sync,randomBytes} from 'node:crypto';
const password=process.argv[2];
if(!password){console.error('Usage: npm run auth:hash -- "your-long-password"');process.exit(1)}
const iterations=210000,salt=randomBytes(24),hash=pbkdf2Sync(password,salt,iterations,64,'sha512');
console.log(`pbkdf2-sha512$${iterations}$${salt.toString('base64url')}$${hash.toString('base64url')}`);
