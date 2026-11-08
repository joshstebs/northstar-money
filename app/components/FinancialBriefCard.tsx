import {parseFinancialBrief, type FinancialBrief} from '@/lib/finance/brief-parser';

export function FinancialBriefCard({stored, fallback, hasData}: {
  stored?: unknown;
  fallback: FinancialBrief;
  hasData: boolean;
}) {
  const saved = hasData ? parseFinancialBrief(stored) : null;
  const brief = saved ?? fallback;
  return <section className="briefSections" aria-label="Weekly financial brief">
    <p>{brief.brief ?? fallback.brief}</p>
    {brief.actions.length > 0 && <div>
      <h3>Recommended actions</h3>
      <ol>{brief.actions.map((action, i) => <li key={i}>{action}</li>)}</ol>
    </div>}
    {(brief.dataQualityCaveats.length > 0 || (saved && fallback.dataQualityCaveats.length > 0)) && <div>
      <h3>Data quality notes</h3>
      <ul>{[...new Set([...brief.dataQualityCaveats, ...fallback.dataQualityCaveats])].map(note => <li key={note}>{note}</li>)}</ul>
    </div>}
  </section>;
}
