import { z } from 'zod';

export const faqItemSchema = z.object({
	id: z.string().optional(),
	question: z.string().min(1, 'กรุณาระบุคำถาม'),
	answer: z.string().min(1, 'กรุณาระบุคำตอบ'),
	is_published: z.boolean().default(true),
	order: z.number().default(0)
});

export const publicConfigSchema = z.object({
	faqs: z.array(faqItemSchema).default([]),
	line_oa_url: z.string().url('URL ไม่ถูกต้อง').or(z.literal('')).optional(),
	facebook_url: z.string().url('URL ไม่ถูกต้อง').or(z.literal('')).optional()
});

export type FaqItem = z.infer<typeof faqItemSchema>;
export type PublicConfig = z.infer<typeof publicConfigSchema>;
