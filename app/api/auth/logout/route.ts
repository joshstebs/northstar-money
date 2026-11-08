import {NextRequest, NextResponse} from 'next/server';
import {SESSION_COOKIE} from '@/lib/security/auth';
import {requireWriteSession} from '@/lib/security/request-auth';

export async function POST(req: NextRequest) {
  const auth = await requireWriteSession(req);
  if (!auth.ok) return NextResponse.json({error: auth.error}, {status: auth.status});
  const response = new NextResponse(null, {status: 303, headers: {Location: '/login'}});
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true, path: '/', maxAge: 0, sameSite: 'strict', secure: process.env.NODE_ENV === 'production'
  });
  return response;
}
