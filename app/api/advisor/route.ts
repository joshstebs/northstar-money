import {NextRequest, NextResponse} from 'next/server';
import {requireWriteSession} from '@/lib/security/request-auth';
import {financialSnapshot} from '@/lib/finance/analytics';

export async function POST(req: NextRequest) {
  const auth = await requireWriteSession(req);
  if (!auth.ok) return NextResponse.json({error: auth.error}, {status: auth.status});
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({error: 'AI advisor is unavailable. The Advice hub still works with recorded household data.'}, {status: 503});
  const body = await req.json().catch(() => null);
  const question = typeof body?.question === 'string' ? body.question.trim().slice(0, 1200) : '';
  if (!question) return NextResponse.json({error: 'Enter a question first.'}, {status: 400});
  try {
    const snapshot = await financialSnapshot();
    if (!snapshot.postedCount) return NextResponse.json({answer: 'Connect a bank or import a statement so NorthStar can answer using recorded household activity.'});
    const {incomeThisMonth, spentThisMonth, netCashFlow, creditDebt} = snapshot.metrics;
    const totals = {incomeThisMonth, spentThisMonth, netCashFlow, creditDebt, categorySpend: snapshot.categorySpend.slice(0, 10),
      budgets: snapshot.budgets.map(({category, amount, spent}) => ({category, amount, spent}))};
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: {authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json'},
      body: JSON.stringify({model: process.env.OPENAI_MODEL || 'gpt-5.6-luna', store: false,
        instructions: 'Explain only the supplied aggregate household CAD totals. State when data is insufficient. Do not invent balances, APRs, savings, legal or tax rules, scores, returns or transactions. Use readable plain text.',
        input: JSON.stringify({question, totals}), max_output_tokens: 700})
    });
    if (response.ok) {
      const data = await response.json();
      const answer = (data.output ?? []).flatMap((item: {content?: {type: string; text?: string}[]}) => item.content ?? [])
        .filter((item: {type: string}) => item.type === 'output_text').map((item: {text?: string}) => item.text).join('\n').trim();
      if (answer) return NextResponse.json({answer});
    }
  } catch {}
  return NextResponse.json({error: 'AI advisor is temporarily unavailable. View your recorded totals and observations in Advice.'}, {status: 502});
}
