import { describe, it, expect } from 'vitest';
import { referralSchema, referralReadSchema, isReferral } from './referral.schema';

// Base v1 medical-emergency doc (same shape as the existing fixtures in referral.test.ts)
const v1Medical = {
	_id: 'referral:01F8MECHEXAMPLEDOCID12345',
	type: 'referral',
	schema_v: 1,
	shelter_code: 'SH001',
	created_at: '2026-07-11T05:00:00.000Z',
	updated_at: '2026-07-11T05:00:00.000Z',
	created_by: 'Staff A',
	evacuee_id: 'evacuee:01F8MECHEVACUEEID1234567',
	referral_type: 'medical-emergency',
	to_org: { name: 'General Hospital', kind: 'hospital', contact: '0812345678' },
	reason: 'Requires urgent medical care',
	urgency: 'urgent',
	status: 'closed',
	timeline: {}
};

const v2Medical = {
	...v1Medical,
	schema_v: 2,
	close_reason: 'ผู้ประสบภัยกลับบ้านแล้ว'
};

describe('Referral schema_v 1|2 reader (CR-167 FR-C1, FR-C4)', () => {
	it('accepts a v1 document unchanged and does not add close_reason', () => {
		const parsed = referralSchema.parse(v1Medical);
		expect(parsed.schema_v).toBe(1);
		expect(parsed).not.toHaveProperty('close_reason');
		expect(isReferral(v1Medical)).toBe(true);
	});

	it('accepts a v2 document carrying close_reason', () => {
		expect(() => referralSchema.parse(v2Medical)).not.toThrow();
		expect(isReferral(v2Medical)).toBe(true);
	});

	it('keeps close_reason in the parsed output (not stripped)', () => {
		const parsed = referralReadSchema.parse(v2Medical);
		expect(parsed.schema_v).toBe(2);
		expect(parsed.close_reason).toBe('ผู้ประสบภัยกลับบ้านแล้ว');
	});

	it('accepts close_reason on every referral_type', () => {
		const capacity = {
			...v2Medical,
			referral_type: 'capacity',
			to_shelter_code: 'SH002',
			to_org: undefined
		};
		const resource = {
			...v2Medical,
			referral_type: 'resource',
			to_org: { name: 'Supplier Co.' }
		};
		const legacy = { ...v2Medical, referral_type: undefined, to_org: undefined };

		expect(isReferral(capacity)).toBe(true);
		expect(isReferral(resource)).toBe(true);
		expect(isReferral(legacy)).toBe(true);
	});

	it('accepts close_reason of exactly 2000 characters', () => {
		const doc = { ...v2Medical, close_reason: 'ก'.repeat(2000) };
		expect(isReferral(doc)).toBe(true);
		expect(() => referralSchema.parse(doc)).not.toThrow();
	});

	it('rejects close_reason longer than 2000 characters', () => {
		const doc = { ...v2Medical, close_reason: 'a'.repeat(2001) };
		expect(isReferral(doc)).toBe(false);

		const result = referralSchema.safeParse(doc);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some((i) => i.path[0] === 'close_reason')).toBe(true);
		}
	});

	it('rejects an over-length close_reason even on a v1 document', () => {
		// schema_v is kept at 1 so the failure is caused by length alone
		const doc = { ...v1Medical, close_reason: 'a'.repeat(2001) };
		const result = referralSchema.safeParse(doc);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some((i) => i.path[0] === 'close_reason')).toBe(true);
		}
	});

	it('rejects schema_v values other than 1 or 2', () => {
		expect(isReferral({ ...v1Medical, schema_v: 3 })).toBe(false);
		expect(isReferral({ ...v1Medical, schema_v: 0 })).toBe(false);
	});
});
