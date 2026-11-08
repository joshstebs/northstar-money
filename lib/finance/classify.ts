import {normalizeCategory} from './planning';

export type FlowTransaction = {
  amount: unknown;
  category?: string | null;
  subcategory?: string | null;
  userCategory?: string | null;
  description?: string | null;
  merchantName?: string | null;
  pending?: boolean;
  currency?: string | null;
  account: {type: string; subtype?: string | null; currency: string};
};

export function accountKind(account: {type: string; subtype?: string | null}) {
  const type = normalizeCategory(`${account.type} ${account.subtype ?? ''}`);
  if (/\b(CREDIT|MASTERCARD|VISA|DEBT|LIABILITY|LOANS?|MORTGAGE|LOC|LINE OF CREDIT)\b/.test(type)) return 'debt';
  if (/\b(INVESTMENTS?|BROKERAGE|RETIREMENT|RRSP|TFSA|FHSA|RESP|ASSET|PROPERTY)\b/.test(type)) return 'asset';
  if (/\b(DEPOSITORY|CHEQUING|CHECKING|SAVINGS?|BANKING|CASH|ACCOUNT)\b/.test(type)) return 'cash';
  return 'unknown';
}

export function budgetStatus(used: number, limit: number, warning = 80) {
  if (used >= limit && (limit > 0 || used > 0)) return 'Over budget';
  return limit > 0 && used * 100 >= limit * warning ? 'Approaching limit' : 'On track';
}

export function classifyTransaction(t: FlowTransaction) {
  const providerCategory = normalizeCategory(t.category);
  const detail = normalizeCategory(t.subcategory);
  const description = normalizeCategory(t.description);
  const category = normalizeCategory(t.userCategory || t.category);
  const cents = Math.round(Number(t.amount) * 100);
  const code = `${providerCategory} ${detail} ${description}`;
  const kind = accountKind(t.account);
  const flow = (type: 'ignore' | 'foreign' | 'transfer' | 'unclassified' | 'income' | 'spending' | 'refund') =>
    ({type, cents, category});

  if (t.pending || !Number.isSafeInteger(cents) || cents === 0) return flow('ignore');
  if ((t.currency ?? t.account.currency).toUpperCase() !== 'CAD') return flow('foreign');
  if (category === 'INTERNAL TRANSFER' || /\b(INTERNAL (?:TRANSFER|PAYMENT|DEPOSIT|WITHDRAWAL)|TRANSFER (?:BETWEEN|TO OWN|FROM OWN) ACCOUNTS?|OWN ACCOUNT TRANSFER|ACCOUNT TRANSFER|CREDIT CARD (?:PAYMENTS?|REPAYMENT)|MASTERCARD (?:PAYMENT|PMT)|VISA (?:PAYMENT|PMT)|PAYMENT (?:THANK YOU|RECEIVED)|LOAN (?:DISBURSEMENT|PAYMENTS?|REPAYMENT)|CASH ADVANCE|BALANCE TRANSFER)\b/.test(code)) return flow('transfer');
  if (cents > 0) {
    if (/\b(REFUNDS?|PURCHASE RETURN|MERCHANDISE RETURN|PURCHASE REVERSAL|RETURN CREDIT|STATEMENT CREDIT|CASH ?BACK|REWARDS REDEMPTION)\b/.test(code) || category === 'REFUND') return flow('refund');
    if (kind !== 'debt' && kind !== 'asset' && t.userCategory && /^INCOME(?: |$)/.test(category)) return flow('income');
    if (kind === 'debt' || kind === 'asset' || /\b(TRANSFER|E-TRANSFER|INTERAC|REVERSAL|REIMBURSEMENT)\b/.test(code)) return flow('unclassified');
    if (/^INCOME(?: |$)/.test(category) || /^INCOME(?: |$)/.test(detail) || /\b(PAYROLL|PAYCHEQUE|PAYCHECK|SALARY|PENSION|WAGES)\b/.test(description)) return flow('income');
    return flow('unclassified');
  }
  if (kind === 'asset') return flow('unclassified');
  return flow('spending');
}
