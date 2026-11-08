export function goalProgress(current: number, target: number, targetDate: Date | null, monthlyContribution: number | null, now = new Date()) {
  const remaining = Math.max(0, Math.round(target * 100) - Math.round(current * 100)) / 100;
  const months = targetDate ? (targetDate.getTime() - now.getTime()) / (30.4375 * 86_400_000) : null;
  const monthlyNeeded = remaining === 0 ? 0 : months === null ? null : Math.ceil(remaining / Math.max(1, months) * 100) / 100;
  const pace = monthlyContribution && monthlyContribution > 0 ? monthlyContribution : null;
  const daysToCompletion = pace ? Math.ceil(remaining / pace * 30.4375) : null;
  const projection = daysToCompletion !== null && daysToCompletion <= 36_525 && remaining > 0
    ? new Date(now.getTime() + daysToCompletion * 86_400_000) : null;
  return {
    remaining, monthlyNeeded, projection,
    percent: target > 0 ? Math.min(100, current / target * 100) : 0,
    status: remaining === 0 ? 'Complete' : months === null ? 'No target date' : months <= 0 ? 'Behind schedule' :
      pace === null ? 'Add contributions to see pace' : projection && targetDate && projection <= targetDate ? 'On track' : 'Behind schedule'
  };
}
