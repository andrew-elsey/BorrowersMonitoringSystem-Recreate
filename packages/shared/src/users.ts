import { z } from 'zod';
import { newPasswordField } from './auth.ts';
import { nothingToUpdate, textField } from './categories.ts';
import { Role } from './enums.ts';

// User management (AUTH-3, admin only). Users are never deleted (BR 15): they are deactivated.

// A staff account as the API returns it. The password hash never leaves the server.
export type User = { id: string; name: string; username: string; role: Role; active: boolean };
export type UserPage = { data: User[]; page: number; pageSize: number; total: number };

// Create body. The admin types a starting password and tells the user, who changes it on the
// Change password screen (owner decision 2026-11-01). Usernames are unique; the API answers
// DUPLICATE_VALUE.
export const userSchema = z.object({
  name: textField('Enter a full name.'),
  username: textField('Enter a username.'),
  role: z.enum(Role, { error: 'Choose a role.' }),
  password: newPasswordField,
});
export type UserInput = z.infer<typeof userSchema>;

// Edit body: name, username, role, and active to deactivate or reactivate. No password here.
export const userUpdateSchema = userSchema
  .omit({ password: true })
  .extend({ active: z.boolean() })
  .partial()
  .refine(...nothingToUpdate);
export type UserUpdate = z.infer<typeof userUpdateSchema>;

// PUT /api/users/:id/password: an admin sets a new password for someone else.
export const resetPasswordSchema = z.object({ password: newPasswordField });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
