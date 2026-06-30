import { z } from 'zod';
import { passwordSchema } from '$lib/auth/password-schema';

export const registerSchema = z.object({
	username: z.string().min(3, 'Username must be at least 3 characters'),
	password: passwordSchema,
	confirmPassword: z.string().min(1, 'Please confirm your password')
});

export type RegisterInput = z.infer<typeof registerSchema>;
