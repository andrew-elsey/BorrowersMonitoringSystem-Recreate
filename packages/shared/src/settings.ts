import { z } from 'zod';
import { realDateField, textField } from './categories.ts';

// Semesters and settings (MD-7, SPEC.md 4).

// Semester dates are calendar dates in the app timezone, sent as YYYY-MM-DD (ARCHITECTURE.md 7).
// The end may equal the start, as the database CHECK (start_date <= end_date) allows.
export const semesterSchema = z
  .object({
    name: textField('Enter a semester name.'),
    startDate: realDateField('Enter a start date.'),
    endDate: realDateField('Enter an end date.'),
  })
  // YYYY-MM-DD strings sort in date order.
  .refine((semester) => semester.endDate >= semester.startDate, {
    path: ['endDate'],
    message: 'The end date cannot be before the start date.',
  });
export type SemesterInput = z.infer<typeof semesterSchema>;

export type Semester = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
};
// GET /api/semesters. `current` is the current semester (null when none), wherever it is in the list.
export type SemesterPage = {
  data: Semester[];
  page: number;
  pageSize: number;
  total: number;
  current: Semester | null;
};

// Strike thresholds are whole numbers. The upper bound only keeps the value in a database integer.
export const THRESHOLD_MAX = 100;
const THRESHOLD_MESSAGE = `Enter a whole number from 1 to ${THRESHOLD_MAX}.`;
const threshold = z
  .number({ error: THRESHOLD_MESSAGE })
  .int(THRESHOLD_MESSAGE)
  .min(1, THRESHOLD_MESSAGE)
  .max(THRESHOLD_MAX, THRESHOLD_MESSAGE);

// BR 11: warning < notice < block. The error goes on the higher threshold of the pair that is out
// of order, so the form marks that field.
export const settingsSchema = z
  .object({
    // Local time HH:mm in the app timezone (SPEC.md 4).
    closingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time as HH:mm.'),
    warningThreshold: threshold,
    noticeThreshold: threshold,
    blockThreshold: threshold,
  })
  .superRefine((s, ctx) => {
    if (s.noticeThreshold <= s.warningThreshold) {
      ctx.addIssue({
        code: 'custom',
        path: ['noticeThreshold'],
        message: `Thresholds must go up: warning, then notice, then block. The warning threshold (${s.warningThreshold}) must be lower than the notice threshold (${s.noticeThreshold}).`,
      });
    }
    if (s.blockThreshold <= s.noticeThreshold) {
      ctx.addIssue({
        code: 'custom',
        path: ['blockThreshold'],
        message: `Thresholds must go up: warning, then notice, then block. The notice threshold (${s.noticeThreshold}) must be lower than the block threshold (${s.blockThreshold}).`,
      });
    }
  });
export type SettingsInput = z.infer<typeof settingsSchema>;

// GET and PUT /api/settings. `timezone` is APP_TIMEZONE, shown next to the closing time; it is not
// editable here.
export type Settings = SettingsInput & { timezone: string };
