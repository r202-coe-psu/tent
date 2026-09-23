import { describe, it, expect, vi } from 'vitest';
import { GET } from './+server';
import type { Cookies } from '@sveltejs/kit';
import type { ThaiDAutofillProfile } from '$lib/features/people';

const mockProfile: ThaiDAutofillProfile = {
	id: 'thaid-1234567890123',
	roleLabel: 'ผู้ลงทะเบียนผ่าน ThaiD',
	person_id: '1234567890123',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	nickname: '',
	gender: 'male',
	birth_year: 2530,
	age: 39,
	phone: '0812345678',
	vulnerable_groups: [],
	special_needs: [],
	medical_conditions: [],
	address: {
		address_no: '123',
		village_no: '1',
		subdistrict: 'ตำบล',
		district: 'อำเภอ',
		province: 'จังหวัด',
		postal_code: '10000'
	}
};

vi.mock('$lib/server/thaid-oauth', () => ({
	consumeCitizenClaimCookie: vi.fn((cookies: Cookies) => {
		const val = cookies.get('thaid_citizen_claim');
		if (val === 'valid-cookie') {
			cookies.delete('thaid_citizen_claim', { path: '/' });
			return mockProfile;
		}
		return null;
	})
}));

describe('GET /api/public/v1/thaid/claim', () => {
	it('returns { profile: null } when no cookie is present', async () => {
		const cookies = {
			get: vi.fn().mockReturnValue(undefined),
			delete: vi.fn()
		} as unknown as Cookies;

		const res = await GET({ cookies } as Parameters<typeof GET>[0]);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({ profile: null });
	});

	it('returns { profile } and consumes cookie when valid cookie is present', async () => {
		const cookiesMap = new Map<string, string>([['thaid_citizen_claim', 'valid-cookie']]);
		const cookies = {
			get: vi.fn((name: string) => cookiesMap.get(name)),
			delete: vi.fn((name: string) => cookiesMap.delete(name))
		} as unknown as Cookies;

		const res = await GET({ cookies } as Parameters<typeof GET>[0]);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({ profile: mockProfile });
		expect(cookies.delete).toHaveBeenCalledWith('thaid_citizen_claim', { path: '/' });
	});
});
