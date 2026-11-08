'use client';

import {useState, type FormEvent} from 'react';

export function AdvisorPanel() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    setError('');
    setAnswer('');
    try {
      const response = await fetch('/api/advisor', {
        method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({question})
      });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? 'Unable to reach AI advisor.');
      else setAnswer(data.answer ?? 'No answer was returned.');
    } catch {setError('Unable to reach AI advisor. Try again.');}
    finally {setBusy(false);}
  }

  return <div className="advisorPanel">
    <form onSubmit={ask}>
      <input aria-label="Your question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Where did we overspend this month?" maxLength={1200} required/>
      <button disabled={busy}>{busy ? 'Reviewing…' : 'Ask AI'}</button>
    </form>
    {error && <p role="alert" className="errorText">{error}</p>}
    {answer && <div className="advisorAnswer" role="status">{answer}</div>}
    <small>Asking sends your question and aggregate CAD totals to the AI provider. Keep account details and credentials out of your question.</small>
  </div>;
}
