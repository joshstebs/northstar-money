import {createHash} from 'node:crypto';
import {normalizeCategory} from './planning';

type PayrollTransaction = {
  accountId: string;
  date: Date;
  description: string;
  merchantName: string | null;
  subcategory: string | null;
};

export function payrollSource(t: PayrollTransaction) {
  const name = t.merchantName || t.description.replace(/\b[\d-]{4,}\b/g, '').trim() || 'Payroll deposit';
  const key = createHash('sha256').update(`${t.accountId}|${normalizeCategory(name)}`).digest('hex');
  const identified = /\b(PAYROLL|PAYCHEQUE|PAYCHECK|SALARY|WAGES)\b/.test(normalizeCategory(`${t.subcategory ?? ''} ${t.description}`));
  return {name, key, identified};
}

export function paymentCadence(dates: Date[], amounts: number[]) {
  if (dates.length < 3) return null;
  const days = dates.slice(0, 6).slice(1).map((date, i) => Math.round((dates[i].getTime() - date.getTime()) / 86_400_000));
  const median = [...days].sort((a, b) => a - b)[Math.floor(days.length / 2)];
  const typical = amounts.slice(0, days.length + 1);
  if (Math.min(...typical) < Math.max(...typical) * .8) return null;
  if (days.every(day => day >= 5 && day <= 9)) return {label: 'Weekly', days: 7, perMonth: 52 / 12};
  if (days.every(day => day >= 12 && day <= 17)) {
    if (days.every(day => Math.abs(day - 14) <= 1)) return {label: 'Every two weeks', days: 14, perMonth: 26 / 12};
    return {label: 'Twice monthly', days: 15, perMonth: 2};
  }
  if (median >= 26 && median <= 33 && days.every(day => day >= 25 && day <= 35)) return {label: 'Monthly', days: 30, perMonth: 1};
  return null;
}
