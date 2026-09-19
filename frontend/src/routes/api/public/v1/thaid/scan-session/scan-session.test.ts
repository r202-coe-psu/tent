import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from './+server';
import { GET as getDetail } from './[id]/+server';
import { completeScanSession, _resetSessionsForTest } from '$lib/server/thaid-scan-session';
// eslint-disable-next-line no-restricted-imports
import type { ThaiDAutofillProfile } from '$lib/features/people/domain/thaid-profile';

const mockProfile: ThaiDAutofillProfile = {
	id: 'thaid-1234567890123',
	roleLabel: 'ผู้ลงทะเบียนผ่าน ThaiD',
	person_id: '1234567890123',
	first_name: 'วิภา',
	last_name: 'ใจดี',
	nickname: '',
	gender: 'female',
	birth_year: 2530,
	age: 39,
	phone: '0891112233',
	vulnerable_groups: [],
	special_needs: [],
	medical_conditions: [],
	address: {
		address_no: '99/1',
		village_no: '',
		subdistrict: 'สุเทพ',
		district: 'เมืองเชียงใหม่',
		province: 'เชียงใหม่',
		postal_code: '50200'
	}
};

describe('Scan Session API endpoints', () => {
	beforeEach(() => {
		_resetSessionsForTest();
	});

	it('POST /api/public/v1/thaid/scan-session creates a session', async () => {
		const mockEvent = {
			url: new URL('https://shelter.test/api/public/v1/thaid/scan-session')
		} as Parameters<typeof POST>[0];

		const res = await POST(mockEvent);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.sessionId).toBeDefined();
		expect(data.expiresAt).toBeGreaterThan(Date.now());
		expect(data.ttlSeconds).toBe(900);
		expect(data.qrUrl).toBe(
			`https://shelter.test/api/v1/auth/oauth/thaid/start?mode=member_scan&session_id=${data.sessionId}`
		);
	});

	it('GET /api/public/v1/thaid/scan-session/[id] returns detail and reflects completion', async () => {
		// 1. Create session via POST
		const postRes = await POST({
			url: new URL('https://shelter.test/api/public/v1/thaid/scan-session')
		} as Parameters<typeof POST>[0]);
		const { sessionId } = await postRes.json();

		// 2. Query initial status
		const detailRes = await getDetail({
			params: { id: sessionId }
		} as unknown as Parameters<typeof getDetail>[0]);
		expect(detailRes.status).toBe(200);
		const initialData = await detailRes.json();
		expect(initialData.status).toBe('pending');
		expect(initialData.profile).toBeNull();

		// 3. Complete session
		completeScanSession(sessionId, mockProfile);

		// 4. Query again
		const updatedRes = await getDetail({
			params: { id: sessionId }
		} as unknown as Parameters<typeof getDetail>[0]);
		expect(updatedRes.status).toBe(200);
		const updatedData = await updatedRes.json();
		expect(updatedData.status).toBe('completed');
		expect(updatedData.profile).toEqual(mockProfile);
	});

	it('GET /api/public/v1/thaid/scan-session/[id] returns 404 for unknown session', async () => {
		const res = await getDetail({
			params: { id: 'nonexistent-session' }
		} as unknown as Parameters<typeof getDetail>[0]);
		expect(res.status).toBe(404);
		const data = await res.json();
		expect(data.status).toBe('expired');
	});
});
