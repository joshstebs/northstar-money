export type FinancialBrief = {
  brief: string | null;
  actions: string[];
  dataQualityCaveats: string[];
};

const wrapperKeys = [
  'financialBrief', 'financial_brief', 'weeklyBrief', 'weekly_brief',
  'monthlyBrief', 'monthly_brief', 'data', 'result', 'response', 'payload', 'output'
] as const;

function readable(value: unknown, limit = 1800) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /^(?:null|undefined|true|false)$/i.test(trimmed)) return null;
  // Never surface a JSON container, fenced block or escaped JSON object as brief copy.
  if (/^(?:\{|\[|`|"(?:[\[{\\]))/.test(trimmed)) return null;
  return trimmed.slice(0, limit);
}

function items(value: unknown, limit: number) {
  return (Array.isArray(value) ? value : [value])
    .map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return readable(item, 420);
      const {title, action, description, detail, recommendation, text} = item as Record<string, unknown>;
      const heading = readable(title, 120);
      const body = readable(action ?? description ?? detail ?? recommendation ?? text, 300);
      return [heading, body].filter(Boolean).join(' — ') || null;
    })
    .filter((item): item is string => Boolean(item))
    .slice(0, limit);
}

function briefText(record: Record<string, unknown>) {
  return readable(record.brief) ?? readable(record.summary) ?? readable(record.overview) ?? readable(record.headline) ?? readable(record.text);
}

function hasBriefShape(record: Record<string, unknown>) {
  return Boolean(briefText(record)) || Array.isArray(record.actions) || Array.isArray(record.recommendedActions) ||
    Array.isArray(record.recommendations) || Array.isArray(record.dataQualityCaveats) || Array.isArray(record.caveats) ||
    Array.isArray(record.warnings);
}

function unwrap(value: unknown): Record<string, unknown> | null {
  let current = value;
  for (let depth = 0; depth < 3; depth++) {
    if (Array.isArray(current)) {
      if (current.length !== 1) return null;
      current = current[0];
      continue;
    }
    if (!current || typeof current !== 'object') return null;
    const record = current as Record<string, unknown>;
    if (hasBriefShape(record)) return record;
    const nested = wrapperKeys.map(key => record[key]).find(item => item && typeof item === 'object');
    if (nested === undefined) return record;
    current = nested;
  }
  return current && typeof current === 'object' && !Array.isArray(current) ? current as Record<string, unknown> : null;
}

function finish(record: Record<string, unknown>): FinancialBrief | null {
  const result = {
    brief: briefText(record),
    actions: items(record.actions ?? record.recommendedActions ?? record.recommendations, 5),
    dataQualityCaveats: items(record.dataQualityCaveats ?? record.caveats ?? record.warnings ?? record.dataQuality, 6)
  };
  return result.brief || result.actions.length || result.dataQualityCaveats.length ? result : null;
}

function complete(value: unknown): FinancialBrief | null {
  const record = unwrap(value);
  return record ? finish(record) : null;
}

export function parseFinancialBrief(input: unknown): FinancialBrief | null {
  let value = input;
  for (let depth = 0; depth < 4 && typeof value === 'string'; depth++) {
    const source = value.trim();
    if (!source) return null;
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
    const candidates = [fenced ?? source];
    const jsonStart = source.search(/[\[{]\s*"/);
    if (jsonStart > 0) candidates.push(source.slice(jsonStart));
    let parsed = false;
    for (const candidate of candidates) {
      const trimmed = candidate.trim();
      if (!/^[\[{"]/.test(trimmed)) continue;
      try { value = JSON.parse(trimmed); parsed = true; break; } catch {}
    }
    if (!parsed) return complete({brief: (fenced ?? source).trim()});
  }
  return complete(value);
}
