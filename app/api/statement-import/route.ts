import {Prisma} from '@prisma/client';
import {NextRequest, NextResponse} from 'next/server';
import {db, ownerUser} from '@/lib/db';
import {requireWriteSession} from '@/lib/security/request-auth';
import {cardIssuers, maxStatementBytes, parseCardStatement, StatementError} from '@/lib/finance/statement-import';

export async function POST(req: NextRequest) {
  const auth = await requireWriteSession(req);
  if (!auth.ok) return NextResponse.json({error: auth.error}, {status: auth.status});
  if (Number(req.headers.get('content-length')) > maxStatementBytes + 10_000) {
    return NextResponse.json({error: 'Choose a statement under 1 MB.'}, {status: 413});
  }
  try {
    const form = await req.formData();
    const file = form.get('file');
    const issuer = cardIssuers.find(name => name === form.get('issuer'));
    const mask = String(form.get('mask') ?? '');
    if (!(file instanceof File) || file.size > maxStatementBytes || !issuer || !/^\d{4}$/.test(mask)) {
      throw new StatementError('Choose a statement under 1 MB, a card issuer, and the last four digits.');
    }
    const entries = parseCardStatement(await file.text(), {dateFormat: String(form.get('dateFormat')), amountMode: String(form.get('amountMode'))});
    if (form.get('mode') !== 'import') {
      return NextResponse.json({count: entries.length, preview: entries.slice(0, 5).map(({date, description, amount}) => ({date: date.toISOString().slice(0, 10), description, amount}))});
    }

    await ownerUser();
    const imported = await db.$transaction(async tx => {
      const connection = await tx.connection.upsert({
        where: {provider_providerItemId: {provider: 'statement', providerItemId: 'owner'}},
        create: {userId: 'owner', provider: 'statement', providerItemId: 'owner', institutionName: 'Statement imports', status: 'manual'},
        update: {}
      });
      const accounts = await tx.account.findMany({where: {userId: 'owner', mask, connection: {provider: {in: ['plaid', 'flinks']}}}, select: {type: true, subtype: true}});
      if (accounts.some(account => /credit|mastercard|visa/i.test(`${account.type} ${account.subtype}`))) {
        throw new StatementError('A connected credit card already uses those last four digits. Use bank sync for that card to avoid counting the same transactions twice.');
      }
      const card = await tx.account.upsert({
        where: {providerAccountId_connectionId: {providerAccountId: `${issuer}:${mask}`, connectionId: connection.id}},
        create: {userId: 'owner', connectionId: connection.id, providerAccountId: `${issuer}:${mask}`, name: issuer, mask, type: 'credit', currency: 'CAD'},
        update: {}
      });
      return (await tx.transaction.createMany({data: entries.map(entry => ({...entry, accountId: card.id, currency: 'CAD'})), skipDuplicates: true})).count;
    }, {timeout: 15_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable});
    return NextResponse.json({imported, skipped: entries.length - imported});
  } catch (error) {
    if (error instanceof StatementError) return NextResponse.json({error: error.message}, {status: 400});
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) {
      return NextResponse.json({error: 'This card is being updated. Retry the import in a moment.'}, {status: 409});
    }
    console.error('Statement import failed', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({error: 'Unable to import this statement. Try again after checking the file.'}, {status: 500});
  }
}
