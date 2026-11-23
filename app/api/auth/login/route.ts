import {NextRequest, NextResponse} from 'next/server';
import {authenticatePassword, authConfigured, createSessionToken, SESSION_COOKIE} from '@/lib/security/auth';
import {clearLoginAttempts, consumeLoginAttempt} from '@/lib/security/rate-limit';

export async function POST(req: NextRequest) {
  if (!authConfigured()) return NextResponse.json({error: 'Private authentication is not configured.'}, {status: 503});
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const client = forwarded || req.headers.get('x-real-ip')?.trim() || 'unknown';
  const attempt = consumeLoginAttempt(client);
  if (!attempt.allowed) {
    return NextResponse.json({error: 'Too many sign-in attempts. Try again shortly.'},
      {status: 429, headers: {'Retry-After': String(attempt.retryAfterSeconds)}});
  }
  const body = await req.json().catch(() => ({}));
  const role = typeof body?.password === 'string' && body.password.length <= 1024 ? authenticatePassword(body.password) : null;
  if (!role) return NextResponse.json({error: 'Invalid password'}, {status: 401});
  clearLoginAttempts(client);
  const res = NextResponse.json({ok: true});
  res.cookies.set(SESSION_COOKIE, createSessionToken(role), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 60 * 60 * 12
  });
  return res;
}
