import { z } from 'zod';
import { normalizeThaiPhone, THAI_MOBILE_PHONE_MESSAGE } from '$lib/db/model';

/** Self-service profile fields (matches PATCH /api/v1/auth/me). */
export const ownProfileSchema = z.object({
	display_name: z.string().trim().min(1, 'ชื่อที่แสดงต้องไม่ว่าง'),
	phone: z
		.string()
		.trim()
		.transform(normalizeThaiPhone)
		.pipe(z.string().regex(/^$|^0\d{9}$/, THAI_MOBILE_PHONE_MESSAGE)),
	email: z.string().trim().email('รูปแบบอีเมลไม่ถูกต้อง').or(z.literal('')),
	organization: z.string().trim(),
	position: z.string().trim()
});

export type OwnProfileInput = z.infer<typeof ownProfileSchema>;
