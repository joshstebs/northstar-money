'use client';

import {useRouter} from 'next/navigation';
import {type FormEvent, type ReactNode, useRef, useState} from 'react';

type Value = string | number | boolean | null | undefined;
type Body = Record<string, Value>;

export function ActionForm({children, button, action, fields = [], path = '/api/advice', method = 'POST', reset = false}: {
  children?: ReactNode;
  button: string;
  action?: Body;
  fields?: {name: string; type?: 'number' | 'null' | 'checkbox'}[];
  path?: string;
  method?: 'POST' | 'DELETE';
  reset?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const input = new FormData(form);
    const body: Body = {...action};
    for (const field of fields) {
      const value = String(input.get(field.name) ?? '');
      body[field.name] = field.type === 'checkbox' ? input.has(field.name) : field.type === 'number' ? Number(value) : field.type === 'null' && !value ? null : value;
    }
    if (action?.kind === 'contribution') {
      requestId.current ??= crypto.randomUUID();
      body.contributionId = requestId.current;
    }
    setBusy(true);
    setStatus('');
    try {
      const result = await fetch(path, {method, ...(method === 'POST' ? {
        headers: {'content-type': 'application/json'}, body: JSON.stringify(body)
      } : {})});
      const data = await result.json().catch(() => null);
      if (!result.ok) {
        if (result.status < 500) requestId.current = null;
        setStatus(data?.error ?? 'The change could not be saved.');
        return;
      }
      requestId.current = null;
      if (reset) form.reset();
      setStatus('Saved.');
      router.refresh();
    } catch {
      setStatus('Connection interrupted. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return <form className="adviceForm" onSubmit={submit}>
    {children}<button type="submit" disabled={busy}>{busy ? 'Saving…' : button}</button>
    <div role="status">{status}</div>
  </form>;
}

export function CurrencyInput({name = 'amount', label, value, minimum = 0, optional = false}: {
  name?: string; label: string; value?: number; minimum?: number; optional?: boolean;
}) {
  return <label>{label}<input name={name} type="number" inputMode="decimal" min={minimum} max={999_999_999} step="0.01" required={!optional} defaultValue={value}/></label>;
}
