import {NextRequest, NextResponse} from 'next/server';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {db, ownerUser} from '@/lib/db';
import {requireWriteSession} from '@/lib/security/request-auth';
import {normalizeCategory} from '@/lib/finance/planning';
import {classifyTransaction} from '@/lib/finance/classify';
import {payrollSource} from '@/lib/finance/payroll';

const id = z.string().trim().min(1).max(100);
const money = z.number().min(0).max(999_999_999).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.0001);
const month = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
const name = z.string().trim().min(1).max(80);
const payload = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('category'), id, category: z.union([name, z.null()])}),
  z.object({kind: z.literal('payroll'), id, confirmed: z.boolean()}),
  z.object({kind: z.literal('balance'), id: id.optional(), name, type: z.enum(['asset', 'liability']), amount: money}),
  z.object({kind: z.literal('remove-balance'), id}),
  z.object({kind: z.literal('budget'), id: id.optional(), month, category: name, amount: money, rollover: z.boolean().default(false)}),
  z.object({kind: z.literal('copy-budgets'), month}),
  z.object({kind: z.literal('budget-settings'), warning: z.number().int().min(1).max(99)}),
  z.object({kind: z.literal('contribution'), id, contributionId: z.uuid(), amount: money.refine(amount => amount > 0)})
]);

class MissingItem extends Error {}
class Conflict extends Error {}

export async function POST(req: NextRequest) {
  const auth = await requireWriteSession(req);
  if (!auth.ok) return NextResponse.json({error: auth.error}, {status: auth.status});
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({error: 'Check the required fields and try again.'}, {status: 400});

  const item = parsed.data;
  const userId = 'owner';
  try {
    await ownerUser();
    if (item.kind === 'category') {
      const result = await db.transaction.updateMany({where: {id: item.id, account: {userId}, pending: false}, data: {userCategory: item.category ? normalizeCategory(item.category) : null}});
      if (!result.count) throw new MissingItem();
    } else if (item.kind === 'payroll') {
      const transaction = await db.transaction.findFirst({where: {id: item.id, account: {userId}}, include: {account: true}});
      if (!transaction || classifyTransaction(transaction).type !== 'income') throw new MissingItem();
      const sourceKey = payrollSource(transaction).key;
      await db.incomeSource.upsert({where: {userId_sourceKey: {userId, sourceKey}}, create: {userId, sourceKey, confirmed: item.confirmed}, update: {confirmed: item.confirmed}});
    } else if (item.kind === 'remove-balance') {
      const result = await db.account.deleteMany({where: {id: item.id, userId, connection: {provider: 'manual'}}});
      if (!result.count) throw new MissingItem();
    } else if (item.kind === 'balance') {
      const data = {name: item.name, type: item.type, currentBalance: item.amount};
      await db.$transaction(async tx => {
        const duplicate = await tx.account.findFirst({where: {
          userId, name: {equals: item.name, mode: 'insensitive'}, ...(item.id ? {id: {not: item.id}} : {})
        }});
        if (duplicate) throw new Conflict('An account with this name already exists.');
        if (item.id) {
          const result = await tx.account.updateMany({where: {id: item.id, userId, connection: {provider: 'manual'}}, data});
          if (!result.count) throw new MissingItem();
          return;
        }
        const connection = await tx.connection.upsert({
          where: {provider_providerItemId: {provider: 'manual', providerItemId: userId}}, update: {},
          create: {provider: 'manual', providerItemId: userId, userId, status: 'manual', institutionName: 'Manual balances'}
        });
        await tx.account.create({data: {...data, userId, connectionId: connection.id, providerAccountId: normalizeCategory(item.name), currency: 'CAD'}});
      });
    } else if (item.kind === 'budget-settings') {
      await db.user.update({where: {id: userId}, data: {budgetWarningPercent: item.warning}});
    } else if (item.kind === 'copy-budgets') {
      const date = new Date(`${item.month}-01T00:00:00Z`);
      const prior = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
      const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
      await db.$transaction(async tx => {
        const budgets = await tx.budget.findMany({where: {userId, month: {gte: prior, lt: next}}});
        const existing = new Set(budgets.filter(row => row.month >= date).map(row => normalizeCategory(row.category)));
        const totals = new Map<string, {amount: Prisma.Decimal; rollover: boolean}>();
        for (const row of budgets.filter(row => row.month < date)) {
          const category = normalizeCategory(row.category);
          if (existing.has(category)) continue;
          const total = totals.get(category);
          totals.set(category, {amount: (total?.amount ?? new Prisma.Decimal(0)).plus(row.amount), rollover: Boolean(total?.rollover || row.rollover)});
        }
        await tx.budget.createMany({data: [...totals].map(([category, values]) => ({userId, category, ...values, month: date})), skipDuplicates: true});
      });
    } else if (item.kind === 'budget') {
      const date = new Date(`${item.month}-01T00:00:00Z`);
      const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
      const category = normalizeCategory(item.category);
      await db.$transaction(async tx => {
        const rows = await tx.budget.findMany({where: {userId, month: {gte: date, lt: next}}});
        const existing = rows.find(row => row.id === item.id);
        if (item.id && !existing) throw new MissingItem();
        if (rows.some(row => row.id !== item.id && normalizeCategory(row.category) === category) && (!existing || normalizeCategory(existing.category) !== category)) {
          throw new Conflict('That category already has a budget this month. Edit the existing limit.');
        }
        const data = {category: existing && normalizeCategory(existing.category) === category ? existing.category : category, amount: item.amount, month: date, rollover: item.rollover};
        if (existing) await tx.budget.update({where: {id: existing.id, userId}, data});
        else await tx.budget.create({data: {...data, userId}});
      });
    } else {
      await db.$transaction(async tx => {
        if (!await tx.goal.findFirst({where: {id: item.id, userId}, select: {id: true}})) throw new MissingItem();
        const created = await tx.goalContribution.createMany({data: [{id: item.contributionId, goalId: item.id, amount: item.amount}], skipDuplicates: true});
        if (created.count) await tx.goal.update({where: {id: item.id, userId}, data: {currentAmount: {increment: item.amount}}});
      });
    }
    return NextResponse.json({ok: true});
  } catch (error) {
    if (error instanceof MissingItem) return NextResponse.json({error: 'This household item no longer exists.'}, {status: 404});
    if (error instanceof Conflict) return NextResponse.json({error: error.message}, {status: 409});
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({error: 'This item already exists. Refresh the page and try again.'}, {status: 409});
    }
    console.error('Advice update failed', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({error: 'Unable to save this change.'}, {status: 500});
  }
}
