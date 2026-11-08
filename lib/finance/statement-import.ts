import {createHash} from 'node:crypto';

export const cardIssuers = ['PC Financial Mastercard', 'Canadian Tire Bank Mastercard', 'Other credit card'] as const;
export const maxStatementBytes = 1_000_000;
type Entry = {date: Date; amount: number; description: string; category: string; providerTransactionId: string};

export class StatementError extends Error {}

function csvRows(source: string) {
  const result: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  const finishCell = () => {row.push(cell.trim()); cell = ''; closed = false;};
  const finishRow = () => {finishCell(); if (row.some(Boolean)) result.push(row); row = [];};
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {cell += '"'; i++;}
      else if (char === '"') {quoted = false; closed = true;}
      else cell += char;
      continue;
    }
    if (char === ',' || char === '\r' || char === '\n') {
      if (char === ',') finishCell();
      else finishRow();
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (closed || char === '"') throw new StatementError('CSV contains an invalid quoted field.');
    else cell += char;
  }
  if (quoted) throw new StatementError('CSV contains an unclosed quoted field.');
  finishRow();
  return result;
}

function parseDate(value: string, dateFormat: string) {
  let iso = value;
  const slash = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slash) {
    if (!['mdy', 'dmy'].includes(dateFormat)) throw new StatementError('Choose the date order used by this CSV.');
    const [, first, second, year] = slash;
    const [month, day] = dateFormat === 'dmy' ? [second, first] : [first, second];
    iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  if (/^\d{8}/.test(iso) && !iso.includes('-')) iso = `${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6, 8)}`;
  const date = new Date(`${iso}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso || iso < '2000-01-01') {
    throw new StatementError('Each transaction must have a valid date.');
  }
  return date;
}

function decimal(value: string) {
  const source = value.trim().replace(/[$,]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!/^[+-]?\d{1,9}(?:\.\d{1,2})?$/.test(source)) throw new StatementError('Each amount must be numeric with at most two decimal places.');
  return Number(source);
}

const ofxField = (block: string, name: string) => block.match(new RegExp(`<${name}>\\s*([^<\\r\\n]+)`, 'i'))?.[1].trim() ?? '';
const decode = (value: string) => value.replace(/&(amp|quot|apos|lt|gt);/g, (_, entity: string) => ({amp: '&', quot: '"', apos: "'", lt: '<', gt: '>'}[entity] ?? ''));

export function parseCardStatement(source: string, {dateFormat, amountMode}: {dateFormat: string; amountMode: string}) {
  if (!source.trim()) throw new StatementError('The statement file is empty.');
  const ofx = /<OFX\b/i.test(source);
  const text = source.replace(/^\uFEFF/, '');
  let currency = 'CAD';
  let records: {date: string; description: string; amount: number; reference: string; category: string; transactionType?: string}[];

  if (ofx) {
    const statements = [...text.matchAll(/<CCSTMTRS\b[^>]*>([\s\S]*?)<\/CCSTMTRS\s*>/gi)];
    if (statements.length !== 1) throw new StatementError('Choose an OFX or QFX file containing exactly one credit-card statement.');
    const block = statements[0][1];
    currency = ofxField(block, 'CURDEF').toUpperCase() || 'CAD';
    const transactions = [...block.matchAll(/<STMTTRN\b[^>]*>([\s\S]*?)<\/STMTTRN\s*>/gi)];
    if (transactions.length !== (block.match(/<STMTTRN\b/gi)?.length ?? 0)) throw new StatementError('The statement contains an incomplete transaction.');
    records = transactions.map(([, t]) => ({
      date: ofxField(t, 'DTPOSTED'), description: decode(ofxField(t, 'NAME') || ofxField(t, 'MEMO')),
      amount: decimal(ofxField(t, 'TRNAMT')), reference: ofxField(t, 'FITID'), category: '', transactionType: ofxField(t, 'TRNTYPE').toUpperCase()
    }));
  } else {
    const [header, ...rows] = csvRows(text);
    if (!header) throw new StatementError('The CSV is missing a header row.');
    const keys = header.map(label => label.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const col = (...aliases: string[]) => aliases.map(alias => keys.indexOf(alias)).find(index => index >= 0) ?? -1;
    const date = col('postingdate', 'posteddate', 'date', 'transactiondate', 'transdate');
    const description = col('description', 'transactiondescription', 'merchant', 'merchantname', 'payee', 'name', 'details');
    const amount = col('amount', 'transactionamount', 'netamount', 'amountcad', 'cadamount');
    const debit = col('debit', 'debits', 'charge', 'withdrawal');
    const credit = col('credit', 'credits', 'deposit');
    const category = col('category');
    const reference = col('transactionid', 'reference', 'referencenumber', 'fitid');
    const currencyIndex = col('currency', 'currencycode');
    if (date < 0 || description < 0 || (amount < 0 && (debit < 0 || credit < 0))) {
      throw new StatementError('CSV needs a Date and Description plus Amount, or separate Debit and Credit columns.');
    }
    if (amount >= 0 && !['charges-positive', 'charges-negative'].includes(amountMode)) throw new StatementError('Choose the sign used for purchases in the CSV.');
    if (rows.some(row => row.length !== header.length)) throw new StatementError('Every CSV row must match the header columns.');
    const currencies = new Set(rows.map(row => row[currencyIndex]?.toUpperCase() || 'CAD'));
    if (currencies.size > 1) throw new StatementError('Import one statement currency per file.');
    currency = [...currencies][0] ?? 'CAD';
    records = rows.map(row => ({
      date: row[date], description: row[description],
      amount: amount >= 0 ? decimal(row[amount]) * (amountMode === 'charges-positive' ? -1 : 1) : Math.abs(decimal(row[credit] || '0')) - Math.abs(decimal(row[debit] || '0')),
      reference: row[reference] ?? '', category: row[category] ?? ''
    }));
  }

  if (currency !== 'CAD') throw new StatementError('Statement import currently supports CAD settlement amounts.');
  if (!records.length || records.length > 3000) throw new StatementError('A statement must contain between 1 and 3,000 transactions.');
  const counts = new Map<string, number>();
  const distinct = new Map<string, Entry>();
  for (const row of records) {
    const date = parseDate(row.date, dateFormat);
    const description = row.description.replace(/\s+/g, ' ').trim().slice(0, 220);
    if (!description) throw new StatementError('Every transaction needs a description.');
    if (row.amount === 0) continue;
    const fingerprint = JSON.stringify([date.toISOString(), Math.round(row.amount * 100), description.toUpperCase()]);
    const ordinal = (counts.get(fingerprint) ?? 0) + 1;
    counts.set(fingerprint, ordinal);
    const key = row.reference ? `${ofx ? 'ofx' : 'csv'}:${row.reference}` : `${fingerprint}|${ordinal}`;
    const providerTransactionId = createHash('sha256').update(key).digest('hex');
    const isPayment = /\b(PAYMENT|PMT|PAIEMENT)\b/i.test(description) || row.transactionType === 'PAYMENT';
    const category = row.amount > 0
      ? isPayment ? 'INTERNAL TRANSFER' : row.transactionType === 'CREDIT' && !row.category ? 'REFUND' : row.category.slice(0, 80) || 'OTHER'
      : row.category.slice(0, 80) || 'OTHER';
    const existing = distinct.get(providerTransactionId);
    if (existing && (existing.amount !== row.amount || existing.date.getTime() !== date.getTime() || existing.description !== description)) throw new StatementError('The same transaction reference has conflicting details.');
    distinct.set(providerTransactionId, {date, amount: row.amount, description, category, providerTransactionId});
  }
  if (!distinct.size) throw new StatementError('The statement has no non-zero transactions.');
  return [...distinct.values()];
}
