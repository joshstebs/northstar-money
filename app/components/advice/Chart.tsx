import {money} from './format';

export function WorthChart({points}: {points: {date: string; net: number}[]}) {
  if (points.length < 2) return <p className="adviceEmpty">At least two dated balance snapshots are needed for a trend. NorthStar begins recording snapshots with successful scheduled refreshes.</p>;
  const values = points.map(point => point.net);
  const low = Math.min(...values), high = Math.max(...values);
  const first = Date.parse(points[0].date), last = Date.parse(points.at(-1)!.date);
  const path = points.map((point, i) => {
    const x = 8 + (Date.parse(point.date) - first) / Math.max(1, last - first) * 344;
    const y = low === high ? 60 : 104 - (point.net - low) / (high - low) * 88;
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
  return <figure className="worthChart">
    <svg viewBox="0 0 360 120" role="img" aria-label={`Net worth history from ${money(values[0])} to ${money(values.at(-1)!)}`}>
      <path d="M8 104 H352 M8 60 H352 M8 16 H352" stroke="var(--advice-border)" fill="none"/>
      <path d={path} stroke="var(--advice-accent)" strokeWidth="2.5" fill="none" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/>
    </svg>
    <figcaption><span>{points[0].date} · {money(values[0])}</span><span>{points.at(-1)!.date} · {money(values.at(-1)!)}</span></figcaption>
  </figure>;
}
