import { z } from 'zod';

/**
 * Password policy: long enough to matter, no composition rules that push people
 * toward "Password1!". Length is what actually helps.
 */
const password = z
  .string()
  .min(10, 'Use at least 10 characters — length matters more than symbols')
  .max(200);

export const registerSchema = z.object({
  email: z.email('That does not look like an email address').toLowerCase().trim(),
  password,
  name: z.string().trim().min(1).max(80).optional(),
});

export const loginSchema = z.object({
  email: z.email('That does not look like an email address').toLowerCase().trim(),
  password: z.string().min(1, 'Enter your password'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'A refresh token is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
