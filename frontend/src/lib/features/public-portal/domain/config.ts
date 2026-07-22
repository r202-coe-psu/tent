import { z } from 'zod';
import type { CatalogDoc } from '$lib/db/model';

export const faqItemSchema = z.object({
	id: z.string().optional(),
	question: z.string().min(1, 'กรุณาระบุคำถาม'),
	answer: z.string().min(1, 'กรุณาระบุคำตอบ'),
	is_published: z.boolean().default(true),
	order: z.number().default(0)
});

export const publicConfigBodySchema = z.object({
	faqs: z.preprocess((val) => {
		if (Array.isArray(val)) {
			// Migrate existing array data to 'public' category
			return { public: val };
		}
		return val || { public: [] };
	}, z.record(z.string(), z.array(faqItemSchema))).default({ public: [] }),
	line_oa_url: z.string().url('URL ไม่ถูกต้อง').or(z.literal('')).optional(),
	facebook_url: z.string().url('URL ไม่ถูกต้อง').or(z.literal('')).optional()
});

export const publicConfigSchema = z.object({
	_id: z.literal('config:public_portal'),
	_rev: z.string().optional(),
	type: z.literal('config'),
	schema_v: z.literal(1),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1)
}).merge(publicConfigBodySchema);

export type FaqItem = z.infer<typeof faqItemSchema>;
export type PublicConfigBody = z.infer<typeof publicConfigBodySchema>;
export interface PublicConfigDoc extends CatalogDoc, PublicConfigBody {
	type: 'config';
}
