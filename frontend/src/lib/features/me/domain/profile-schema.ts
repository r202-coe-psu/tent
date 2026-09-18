import { z } from 'zod';

/** Self-service profile fields (matches PATCH /api/v1/auth/me). */
export const ownProfileSchema = z.object({
	display_name: z.string().trim().min(1, 'ชื่อที่แสดงต้องไม่ว่าง'),
	phone: z
		.string()
		.trim()
		.regex(/^$|^0[0-9]{9}$/, 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0'),
	email: z.string().trim().email('รูปแบบอีเมลไม่ถูกต้อง').or(z.literal('')),
	organization: z.string().trim(),
	position: z.string().trim()
});

export type OwnProfileInput = z.infer<typeof ownProfileSchema>;
