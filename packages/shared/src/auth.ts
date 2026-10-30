import { z } from 'zod';

// Password policy (ARCHITECTURE.md 5): at least 10 characters, no other composition rules.
export const PASSWORD_MIN_LENGTH = 10;
// Caps the text argon2 has to hash, so one request cannot make hashing expensive (SPEC.md 7).
// shortcut: 200 is borrowed from the name limit in SPEC.md 7 and not yet confirmed by the owner; record the final value in SPEC.md 7.
export const PASSWORD_MAX_LENGTH = 200;
// Names are at most 200 characters (SPEC.md 7).
const USERNAME_MAX_LENGTH = 200;

// No minimum length here on purpose: a short password just fails with the generic login error.
export const loginSchema = z.object({
  username: z.string().trim().min(1).max(USERNAME_MAX_LENGTH),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
