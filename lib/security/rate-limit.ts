type Entry = {count: number; resetAt: number};

const attempts = new Map<string, Entry>();
const limit = 20;
const windowMs = 15 * 60_000;
const maxKeys = 2_000;

export function consumeLoginAttempt(key: string, now = Date.now()) {
  if (attempts.size > maxKeys) {
    for (const [entryKey, entry] of attempts) if (entry.resetAt <= now) attempts.delete(entryKey);
  }
  const existing = attempts.get(key);
  if (!existing || existing.resetAt <= now) {
    attempts.set(key, {count: 1, resetAt: now + windowMs});
    return {allowed: true, remaining: limit - 1, retryAfterSeconds: 0};
  }
  if (existing.count >= limit) {
    return {allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))};
  }
  existing.count += 1;
  return {allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0};
}

export function clearLoginAttempts(key: string) {
  attempts.delete(key);
}
