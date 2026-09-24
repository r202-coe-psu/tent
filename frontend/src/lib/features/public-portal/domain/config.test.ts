import { describe, it, expect } from 'vitest';
import { publicConfigBodySchema } from './config';
import { DEFAULT_PUBLIC_PORTAL_CONFIG } from './config.fixture';

describe('DEFAULT_PUBLIC_PORTAL_CONFIG', () => {
	it('validates successfully against publicConfigBodySchema', () => {
		const result = publicConfigBodySchema.safeParse(DEFAULT_PUBLIC_PORTAL_CONFIG);
		expect(result.success).toBe(true);
	});

	it('contains 3 FAQ categories: public, registration, volunteer', () => {
		expect(Object.keys(DEFAULT_PUBLIC_PORTAL_CONFIG.faqs)).toEqual([
			'public',
			'registration',
			'volunteer'
		]);
		expect(DEFAULT_PUBLIC_PORTAL_CONFIG.faqs.public).toHaveLength(5);
		expect(DEFAULT_PUBLIC_PORTAL_CONFIG.faqs.registration).toHaveLength(4);
		expect(DEFAULT_PUBLIC_PORTAL_CONFIG.faqs.volunteer).toHaveLength(4);
	});

	it('leaves contact information empty by default (no seed for social/contacts)', () => {
		expect(DEFAULT_PUBLIC_PORTAL_CONFIG.phone_number).toBe('');
		expect(DEFAULT_PUBLIC_PORTAL_CONFIG.line_oa_url).toBe('');
		expect(DEFAULT_PUBLIC_PORTAL_CONFIG.facebook_url).toBe('');
	});

	it('ensures each FAQ item has a valid UUID, sequential order, and is published', () => {
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		for (const items of Object.values(DEFAULT_PUBLIC_PORTAL_CONFIG.faqs)) {
			items.forEach((item, index) => {
				expect(item.id).toMatch(uuidRegex);
				expect(item.order).toBe(index);
				expect(item.is_published).toBe(true);
				expect(item.question.length).toBeGreaterThan(0);
				expect(item.answer.length).toBeGreaterThan(0);
				expect(item.question_en).toBeDefined();
				expect(item.answer_en).toBeDefined();
			});
		}
	});
});
