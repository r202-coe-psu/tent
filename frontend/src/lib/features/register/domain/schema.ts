import { z } from 'zod';
import { passwordSchema } from '$lib/auth/password-schema';

export const registerSchema = z.object({
	username: z.string().min(3, 'Username ต้องมีอย่างน้อย 3 ตัวอักษร'),
	password: passwordSchema,
	confirmPassword: z.string().min(1, 'Please confirm your password')
});

export type RegisterInput = z.infer<typeof registerSchema>;
