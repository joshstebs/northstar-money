export const householdDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(now);

export function normalizeCategory(value: string | null | undefined) {
  return (value?.trim() || 'Other').replace(/[_\s]+/g, ' ').trim().toUpperCase();
}

type PlanningInput =
  | {kind: 'budget'; category: string; amount: number; month: Date}
  | {kind: 'goal'; id?: string; name: string; targetAmount: number; currentAmount: number; targetDate: Date | null}
  | {kind: 'debt-terms'; accountId: string; apr: number | null; minimumPayment: number | null};

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  if (value.trim().length > 100) throw new Error(`${field} is too long`);
  return value.trim();
}
function amount(value: unknown, field: string, maximum = Infinity): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) throw new Error(`${field} must be a non-negative number`);
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > maximum) throw new Error(`${field} must be between 0 and ${maximum === Infinity ? 'a finite amount' : maximum}`);
  return result;
}
function blank(value: unknown) {return value === undefined || value === null || value === '';}
function date(value: unknown): Date | null {
  if (blank(value)) return null;
  if (typeof value !== 'string' || (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-'))) throw new Error('targetDate must be YYYY-MM-DD');
  const result = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) throw new Error('targetDate must be a valid calendar date');
  return result;
}
export function parsePlanningInput(value: unknown, now = new Date()): PlanningInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A planning item is required');
  const b = value as Record<string, unknown>;
  if (b.kind === 'budget') {
    const month = blank(b.month) ? householdDay(now).slice(0, 7) : b.month;
    if (typeof month !== 'string' || (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000-'))) throw new Error('month must be YYYY-MM');
    return {kind: 'budget', category: text(b.category, 'category'), amount: amount(b.amount, 'amount'), month: new Date(`${month}-01T00:00:00.000Z`)};
  }
  if (b.kind === 'goal' && amount(b.targetAmount, 'targetAmount', 999_999_999) === 0 && blank(b.id)) {
    throw new Error('targetAmount must be greater than zero');
  }
  if (b.kind === 'goal') return {kind: 'goal', id: blank(b.id) ? undefined : text(b.id, 'id'), name: text(b.name, 'name'), targetAmount: amount(b.targetAmount, 'targetAmount'), currentAmount: blank(b.currentAmount) ? 0 : amount(b.currentAmount, 'currentAmount'), targetDate: date(b.targetDate)};
  if (b.kind === 'debt-terms') return {kind: 'debt-terms', accountId: text(b.accountId, 'accountId'), apr: blank(b.apr) ? null : amount(b.apr, 'apr', 100), minimumPayment: blank(b.minimumPayment) ? null : amount(b.minimumPayment, 'minimumPayment')};
  throw new Error('Unknown planning item');
}
