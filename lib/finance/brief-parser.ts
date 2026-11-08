export type FinancialBrief = {
  brief: string | null;
  actions: string[];
  dataQualityCaveats: string[];
};

function readable(value: unknown, limit = 1800) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && !/^(?:[\[{]|[`]{3}|"(?:[\[{]|\\))/.test(trimmed) ? trimmed.slice(0, limit) : null;
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

export function parseFinancialBrief(input: unknown): FinancialBrief | null {
  let value = input;
  for (let depth = 0; depth < 3 && typeof value === 'string'; depth++) {
    const source = value.trim();
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
    const jsonStart = source.search(/[\[{]\s*"(?:brief|summary|actions|dataQualityCaveats)"\s*:/);
    const candidate = (fenced ?? (jsonStart > 0 ? source.slice(jsonStart) : source)).trim();
    if (!['{', '[', '"', '`'].some(prefix => candidate.startsWith(prefix))) {
      const brief = readable(candidate);
      return brief ? {brief, actions: [], dataQualityCaveats: []} : null;
    }
    try { value = JSON.parse(candidate); }
    catch { return null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const brief = readable(value);
    return brief ? {brief, actions: [], dataQualityCaveats: []} : null;
  }
  const raw = value as Record<string, unknown>;
  const result = {
    brief: readable(raw.brief ?? raw.summary),
    actions: items(raw.actions, 5),
    dataQualityCaveats: items(raw.dataQualityCaveats, 6)
  };
  return result.brief || result.actions.length || result.dataQualityCaveats.length ? result : null;
}
