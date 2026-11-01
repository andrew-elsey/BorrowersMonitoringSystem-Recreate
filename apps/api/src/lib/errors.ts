// An error with an HTTP status and a stable code, sent in the standard format (ARCHITECTURE.md 7).
// `message` must be safe to show to staff.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// True when Prisma rejected a query with this error code, for example 'P2002' (a unique value is
// already used) or 'P2003' (a foreign key still points at the row).
export function isPrismaError(error: unknown, code: string): boolean {
  return (error as { code?: unknown } | null)?.code === code;
}
