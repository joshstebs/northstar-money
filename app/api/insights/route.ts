import {NextResponse} from 'next/server';
import {requireSession} from '@/lib/security/request-auth';
import {financialSnapshot} from '@/lib/finance/analytics';
import {parseFinancialBrief} from '@/lib/finance/brief-parser';

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return NextResponse.json({error: auth.error}, {status: auth.status});
  const snapshot = await financialSnapshot();
  const weekly = snapshot.postedCount ? snapshot.storedInsights.find(item => item.type === 'weekly') : null;
  const parsed = parseFinancialBrief(weekly?.body);
  return NextResponse.json({snapshot, aiBrief: parsed?.brief ?? null, financialBrief: parsed, aiConfigured: Boolean(process.env.OPENAI_API_KEY)});
}
