import { CSV_IMPORT_MAX_BYTES } from '@bms/shared';
import type { RequestHandler } from 'express';
import multer from 'multer';
import { ApiError } from '../lib/errors.ts';

// One CSV file in the multipart field "file", kept in memory (MD-6, SPEC.md 7, ARCHITECTURE.md
// 12.3). multer stops reading as soon as a limit is passed, so an oversized upload is refused
// before any parsing.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CSV_IMPORT_MAX_BYTES, files: 1, fields: 0, parts: 1 },
}).single('file');

const TOO_LARGE = new Set([
  'LIMIT_FILE_SIZE',
  'LIMIT_FILE_COUNT',
  'LIMIT_PART_COUNT',
  'LIMIT_FIELD_COUNT',
]);

export const csvUpload: RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError && TOO_LARGE.has(error.code)) {
      const message = `Upload one CSV file of at most ${CSV_IMPORT_MAX_BYTES / 1024 / 1024} MB.`;
      return next(new ApiError(413, 'PAYLOAD_TOO_LARGE', message));
    }
    // A broken multipart body or a file under another field name: the client's mistake.
    if (error) {
      const message = 'The upload could not be read. Choose the CSV file again.';
      return next(new ApiError(400, 'VALIDATION_ERROR', message, { fields: { file: [message] } }));
    }
    if (!req.file) {
      const message = 'Choose a CSV file.';
      return next(new ApiError(400, 'VALIDATION_ERROR', message, { fields: { file: [message] } }));
    }
    next();
  });
};
