import {NextRequest, NextResponse} from 'next/server';
import {requireWriteSession} from '@/lib/security/request-auth';
import {ownerUser} from '@/lib/db';
import {createFlinksConnection, syncFlinksConnection} from '@/lib/finance/sync-flinks';

export async function POST(req: NextRequest) {
  const auth = await requireWriteSession(req);
  if (!auth.ok) return NextResponse.json({error: auth.error}, {status: auth.status});
  if (!['FLINKS_INSTANCE', 'FLINKS_CUSTOMER_ID', 'FLINKS_AUTH_KEY', 'FLINKS_API_SECRET', 'FLINKS_BASE_URL'].every(name => process.env[name]?.trim())) {
    return NextResponse.json({error: 'Flinks is not configured.'}, {status: 503});
  }
  const body = await req.json().catch(() => null);
  const loginId = typeof body?.loginId === 'string' ? body.loginId.trim() : '';
  if (!/^[a-zA-Z0-9_-]{16,160}$/.test(loginId)) return NextResponse.json({error: 'Flinks returned an invalid connection identifier.'}, {status: 400});
  try {
    await ownerUser();
    const institution = typeof body.institution === 'string' ? body.institution.slice(0, 100) : null;
    const connection = await createFlinksConnection(loginId, institution);
    try {
      const result = await syncFlinksConnection(connection.id);
      return NextResponse.json({persisted: true, initialSync: result});
    } catch {
      return NextResponse.json({persisted: true, error: 'Flinks connection saved. Refresh data to retry the initial sync.'}, {status: 202});
    }
  } catch {
    return NextResponse.json({error: 'Unable to save this Flinks connection.'}, {status: 502});
  }
}
