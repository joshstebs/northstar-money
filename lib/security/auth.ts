import {createHmac,pbkdf2Sync,timingSafeEqual} from 'node:crypto';

export const SESSION_COOKIE = 'northstar_session';
export type HouseholdRole = 'owner' | 'spouse';

export function authConfigured() {
  return Boolean(process.env.APP_AUTH_SECRET && process.env.APP_AUTH_PASSWORD_HASH);
}

function passwordMatches(password: string, encoded?: string) {
  if (!encoded) return false;
  const [scheme, it, salt, expected] = encoded.split('$');
  const iterations = Number(it);
  if (scheme !== 'pbkdf2-sha512' || !Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000 || !salt || !expected) return false;
  try {
    const wanted = Buffer.from(expected, 'base64url');
    if (wanted.length !== 64) return false;
    const actual = pbkdf2Sync(password, Buffer.from(salt, 'base64url'), iterations, wanted.length, 'sha512');
    return timingSafeEqual(wanted, actual);
  } catch { return false; }
}

// Both roles access the same private household dataset, but authenticate separately.
export function authenticatePassword(password: string): HouseholdRole | null {
  if (passwordMatches(password, process.env.APP_AUTH_PASSWORD_HASH)) return 'owner';
  if (passwordMatches(password, process.env.APP_SPOUSE_PASSWORD_HASH)) return 'spouse';
  return null;
}

export function verifyPassword(password: string) { return authenticatePassword(password) !== null; }

function sign(data: string) {
  const secret = process.env.APP_AUTH_SECRET;
  if (!secret) throw new Error('APP_AUTH_SECRET is required');
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function createSessionToken(role: HouseholdRole = 'owner') {
  const payload = Buffer.from(JSON.stringify({sub: role, exp: Date.now() + 1000 * 60 * 60 * 12})).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token?: string | null) {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return (p.sub === 'owner' || p.sub === 'spouse') && typeof p.exp === 'number' && p.exp > Date.now();
  } catch { return false; }
}
