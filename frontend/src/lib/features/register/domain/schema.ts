import { z } from 'zod';

export const registerSchema = z.object({
	username: z.string().min(3, 'Username must be at least 3 characters'),
	password: z.string().min(6, 'Password must be at least 6 characters'),
	confirmPassword: z.string().min(1, 'Please confirm your password')
});

export type RegisterInput = z.infer<typeof registerSchema>;
