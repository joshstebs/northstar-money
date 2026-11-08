'use client';

import {useRouter} from 'next/navigation';
import {type FormEvent, useState} from 'react';

type Preview = {count: number; preview: {date: string; description: string; amount: number}[]};

export function StatementImport() {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set('mode', preview ? 'import' : 'preview');
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/statement-import', {method: 'POST', body: data});
      const body = await response.json();
      if (!response.ok) {setMessage(body.error ?? 'Unable to read the statement.'); return;}
      if (!preview) {setPreview(body); return;}
      setPreview(null);
      setMessage(`Imported ${body.imported} transactions. Skipped ${body.skipped} already imported.`);
      form.reset();
      router.refresh();
    } catch {setMessage('Statement upload failed. Try again.');}
    finally {setBusy(false);}
  }

  return <details className="statementImport">
    <summary>Import a credit-card statement</summary>
    <p>Upload a PC Financial CSV or a Canadian Tire Bank OFX or QFX export. Use one format per card for repeat imports. File limit 1 MB.</p>
    <form className="adviceForm" onSubmit={submit} onChange={() => {setPreview(null); setMessage('');}}>
      <label>Card issuer<select name="issuer"><option>PC Financial Mastercard</option><option>Canadian Tire Bank Mastercard</option><option>Other credit card</option></select></label>
      <label>Last four digits<input name="mask" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required autoComplete="off"/></label>
      <label>Statement file<input name="file" type="file" accept=".csv,.ofx,.qfx" required/></label>
      <label>CSV date format<select name="dateFormat"><option value="iso">YYYY-MM-DD</option><option value="mdy">MM/DD/YYYY</option><option value="dmy">DD/MM/YYYY</option></select></label>
      <label>CSV purchase amounts<select name="amountMode"><option value="">Choose for a signed Amount column</option><option value="charges-positive">Purchases are positive</option><option value="charges-negative">Purchases are negative</option></select></label>
      <small>OFX, QFX and CSVs with Debit and Credit columns use the signs from the file.</small>
      {preview && <div>
        <b>Preview of {preview.count} transactions</b>
        <ul>{preview.preview.map((entry, index) => <li key={index}>{entry.date} · {entry.description} · {entry.amount.toFixed(2)} CAD</li>)}</ul>
      </div>}
      <button disabled={busy}>{busy ? 'Reading statement…' : preview ? 'Import these transactions' : 'Preview statement'}</button>
      <div role="status">{message}</div>
    </form>
  </details>;
}
