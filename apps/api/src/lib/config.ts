// Settings read from environment variables (ARCHITECTURE.md section 10). Never hardcode these.

function readInt(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}, got "${raw}"`);
  }
  return value;
}

export const config = {
  // The API always listens on 3000 inside the container; only nginx reaches it.
  port: 3000,
  // Number of proxies in front of the API (nginx = 1). Rate limits depend on this (ARCHITECTURE.md 12.3).
  trustProxyHops: readInt('TRUST_PROXY_HOPS', 1, 0),
  // Password hashing limiter (ARCHITECTURE.md 12.4): hashes running at once, and hashes allowed to wait.
  hashConcurrency: readInt('HASH_CONCURRENCY', 2, 1),
  hashQueueMax: readInt('HASH_QUEUE_MAX', 10, 0),
  // Business dates (closing time, "today", semesters) use this zone (ARCHITECTURE.md 6).
  timezone: process.env.APP_TIMEZONE || 'Asia/Manila',
  // The containers set NODE_ENV=production. The seed adds sample data only outside production.
  isProduction: process.env.NODE_ENV === 'production',
};
