import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { ApiError } from '../lib/errors.ts';
import { HashingBusyError } from '../lib/password.ts';

// How long a client should wait when the hashing queue is full (ARCHITECTURE.md 12.4).
const SERVER_BUSY_RETRY_SECONDS = 5;

// The one error handler: every error leaves as { error: { code, message, details } } (ARCHITECTURE.md 7).
// Express recognizes an error handler by its four parameters, so `next` must stay even though it is unused.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const { status, code, message, details } = toApiError(error);
  if (status === 503) res.set('Retry-After', String(SERVER_BUSY_RETRY_SECONDS));
  res.status(status).json({ error: { code, message, details } });
};

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof z.ZodError) {
    return new ApiError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', {
      fields: z.flattenError(error).fieldErrors,
    });
  }
  if (error instanceof HashingBusyError) {
    return new ApiError(503, 'SERVER_BUSY', 'The server is busy. Try again in a few seconds.');
  }
  // Errors from express.json(): body over the size limit, or not valid JSON.
  const type = (error as { type?: string }).type;
  if (type === 'entity.too.large') {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
  }
  if (type === 'entity.parse.failed') {
    return new ApiError(400, 'VALIDATION_ERROR', 'The request body is not valid JSON.');
  }
  // Unexpected: log the details server-side, never send them to the client.
  console.error(error);
  return new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong.');
}
