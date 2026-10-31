// The one way the web app talks to the API (ARCHITECTURE.md 5 and 7).

// An API error in the standard format. `message` is safe to show to staff.
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  // From the Retry-After header on 429 RATE_LIMITED and 503 SERVER_BUSY.
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown>,
    retryAfterSeconds: number | null,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type StandardErrorBody = { error?: { code?: string; message?: string; details?: unknown } };

export async function apiFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    // CSRF: the API refuses state-changing requests without this header (ARCHITECTURE.md 5).
    headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  // nginx may answer with something other than JSON (a 502 while the api restarts, for example).
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) throw toApiRequestError(response, json as StandardErrorBody | null);
  return json as T;
}

function toApiRequestError(response: Response, body: StandardErrorBody | null): ApiRequestError {
  const retryAfter = Number(response.headers.get('Retry-After'));
  const details = body?.error?.details;
  return new ApiRequestError(
    response.status,
    body?.error?.code ?? 'INTERNAL_ERROR',
    body?.error?.message ?? 'Something went wrong. Please try again.',
    typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : {},
    retryAfter > 0 ? retryAfter : null,
  );
}

// The text to show for an error. On 429 and 503 the API's vague "Try again later" becomes
// "Try again in N seconds" from Retry-After (AUTH-4).
export function errorText(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return 'Could not reach the server. Please try again.';
  if (error.retryAfterSeconds === null) return error.message;
  const seconds = error.retryAfterSeconds === 1 ? '1 second' : `${error.retryAfterSeconds} seconds`;
  return `${error.message.replace(/\s*Try again.*$/, '')} Try again in ${seconds}.`;
}

// Field errors from a VALIDATION_ERROR response: details.fields is { fieldName: [messages] }.
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiRequestError)) return {};
  const fields = (error.details.fields ?? {}) as Record<string, string[] | undefined>;
  const result: Record<string, string> = {};
  for (const [name, messages] of Object.entries(fields)) {
    if (messages?.[0]) result[name] = messages[0];
  }
  return result;
}
