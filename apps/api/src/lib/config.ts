// Settings read from environment variables (ARCHITECTURE.md section 10). Never hardcode these.

function readNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  }
  return value;
}

export const config = {
  // The API always listens on 3000 inside the container; only nginx reaches it.
  port: 3000,
  // Number of proxies in front of the API (nginx = 1). Rate limits depend on this (ARCHITECTURE.md 12.3).
  trustProxyHops: readNonNegativeInt('TRUST_PROXY_HOPS', 1),
};
