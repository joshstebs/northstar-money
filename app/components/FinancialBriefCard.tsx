import {parseFinancialBrief, type FinancialBrief} from '@/lib/finance/brief-parser';

type Figures = {
  income?: number | null;
  spending?: number | null;
  net?: number | null;
  spendingChangePct?: number | null;
};

type Upcoming = {merchant: string; average: number; next: string};

const money = (amount: number) => new Intl.NumberFormat('en-CA', {style: 'currency', currency: 'CAD', maximumFractionDigits: 2}).format(amount);
const figure = (value: number | null | undefined) => value === null || value === undefined ? '—' : money(value);

export function FinancialBriefCard({stored, fallback, hasData, figures, observations = [], upcoming = [], periodLabel}: {
  stored?: unknown;
  fallback: FinancialBrief;
  hasData: boolean;
  figures?: Figures;
  observations?: string[];
  upcoming?: Upcoming[];
  periodLabel?: string;
}) {
  const saved = hasData ? parseFinancialBrief(stored) : null;
  const brief = saved ?? fallback;
  const actions = brief.actions.length ? brief.actions : fallback.actions;
  const notes = [...new Set([...brief.dataQualityCaveats, ...fallback.dataQualityCaveats])];
  const showFigures = hasData && figures && [figures.income, figures.spending, figures.net].some(value => value !== null && value !== undefined);

  return <section className="briefSections" aria-label="Weekly financial brief">
    {periodLabel && <p className="briefPeriod">{periodLabel}</p>}
    <p className="briefLead">{brief.brief ?? fallback.brief}</p>
    {showFigures && <dl className="briefFigures">
      <div><dt>Income</dt><dd>{figure(figures.income)}</dd></div>
      <div><dt>Spending</dt><dd>{figure(figures.spending)}</dd></div>
      <div><dt>Net cash flow</dt><dd className={(figures.net ?? 0) < 0 ? 'negative' : 'positive'}>{figure(figures.net)}</dd></div>
      {figures.spendingChangePct !== null && figures.spendingChangePct !== undefined &&
        <div><dt>Spending vs. last month</dt><dd>{figures.spendingChangePct > 0 ? '+' : ''}{figures.spendingChangePct}%</dd></div>}
    </dl>}
    {hasData && observations.length > 0 && <div className="briefBlock">
      <h3>Spending observations</h3>
      <ul>{observations.slice(0, 4).map((note, i) => <li key={`${note}-${i}`}>{note}</li>)}</ul>
    </div>}
    {actions.length > 0 && <div className="briefBlock">
      <h3>Recommended actions</h3>
      <ol>{actions.slice(0, 5).map((action, i) => <li key={i}>{action}</li>)}</ol>
    </div>}
    {hasData && upcoming.length > 0 && <div className="briefBlock">
      <h3>Upcoming bills and recurring payments</h3>
      <ul className="briefBills">{upcoming.slice(0, 4).map(item => <li key={item.merchant}>
        <span>{item.merchant}<small>Expected around {item.next}</small></span><b>{money(item.average)}</b>
      </li>)}</ul>
    </div>}
    {notes.length > 0 && <div className="briefBlock briefNotes">
      <h3>Data quality notes</h3>
      <ul>{notes.slice(0, 6).map(note => <li key={note}>{note}</li>)}</ul>
    </div>}
    {!hasData && <p className="briefEmpty">Connect an account or import a statement to build a brief from recorded activity.</p>}
  </section>;
}
