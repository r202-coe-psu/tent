import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	createScanSession,
	getScanSession,
	completeScanSession,
	cleanupExpiredSessions,
	_resetSessionsForTest
} from './thaid-scan-session';
import type { ThaiDAutofillProfile } from '$lib/features/people/domain/thaid-profile';

const SAMPLE_PROFILE: ThaiDAutofillProfile = {
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

describe('thaid-scan-session', () => {
	beforeEach(() => {
		_resetSessionsForTest();
	});

	it('creates a session with pending status and valid expiry', () => {
		const session = createScanSession(60);
		expect(session.id).toBeDefined();
		expect(session.id.length).toBe(32);
		expect(session.status).toBe('pending');
		expect(session.expiresAt).toBeGreaterThan(Date.now());

		const fetched = getScanSession(session.id);
		expect(fetched?.id).toBe(session.id);
	});

	it('completes a session and emits completed event', async () => {
		const session = createScanSession(60);
		const onCompleted = vi.fn();
		session.emitter.on('completed', onCompleted);

		const ok = completeScanSession(session.id, SAMPLE_PROFILE);
		expect(ok).toBe(true);
		expect(onCompleted).toHaveBeenCalledWith(SAMPLE_PROFILE);

		const updated = getScanSession(session.id);
		expect(updated?.status).toBe('completed');
		expect(updated?.profile).toEqual(SAMPLE_PROFILE);
	});

	it('fails to complete non-existent or already completed session', () => {
		expect(completeScanSession('unknown-id', SAMPLE_PROFILE)).toBe(false);

		const session = createScanSession(60);
		completeScanSession(session.id, SAMPLE_PROFILE);
		expect(completeScanSession(session.id, SAMPLE_PROFILE)).toBe(false);
	});

	it('handles expiration correctly', () => {
		const session = createScanSession(10); // 10s TTL
		const onExpired = vi.fn();
		session.emitter.on('expired', onExpired);

		// Fast-forward now past expiry
		cleanupExpiredSessions(session.expiresAt + 1);
		expect(onExpired).toHaveBeenCalled();
		expect(getScanSession(session.id)).toBeNull();
	});
});
