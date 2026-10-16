import { z } from 'zod';

export const loginSchema = z.object({
	username: z.string().min(1, 'กรุณากรอกชื่อผู้ใช้หรือเบอร์โทรศัพท์'),
	password: z.string().min(1, 'กรุณากรอกรหัสผ่าน')
});

export type LoginInput = z.infer<typeof loginSchema>;
