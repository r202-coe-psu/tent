import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	createScanSession,
	getScanSession,
	completeScanSession,
	_resetSessionsForTest
} from './thaid-scan-session';
import type { ThaiDAutofillProfile } from '$lib/features/people';

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

	it('creates a session with pending status and default 900s expiry', () => {
		const session = createScanSession();
		expect(session.id).toBeDefined();
		expect(session.id.length).toBe(32);
		expect(session.status).toBe('pending');
		// ~900s into the future
		expect(session.expiresAt - Date.now()).toBeGreaterThan(890_000);
		expect(session.expiresAt - Date.now()).toBeLessThanOrEqual(900_000);

		const fetched = getScanSession(session.id);
		expect(fetched?.id).toBe(session.id);
	});

	it('syncs session lifecycle across cluster messages', () => {
		const fakeId = 'remote-worker-session-12345';
		const expiresAt = Date.now() + 900_000;

		// 1. Simulate worker receiving create message
		process.emit(
			'message' as never,
			{
				topic: 'thaid-scan-session',
				action: 'create',
				session: {
					id: fakeId,
					createdAt: Date.now(),
					expiresAt,
					status: 'pending'
				}
			} as never
		);

		const session = getScanSession(fakeId);
		expect(session).toBeDefined();
		expect(session?.id).toBe(fakeId);
		expect(session?.status).toBe('pending');

		// 2. Simulate worker receiving complete message
		const onCompleted = vi.fn();
		session?.emitter.on('completed', onCompleted);

		process.emit(
			'message' as never,
			{
				topic: 'thaid-scan-session',
				action: 'complete',
				id: fakeId,
				profile: SAMPLE_PROFILE
			} as never
		);

		expect(onCompleted).toHaveBeenCalledWith(SAMPLE_PROFILE);
		expect(session?.status).toBe('completed');
		expect(session?.profile).toEqual(SAMPLE_PROFILE);

		// 3. Simulate worker receiving expire message
		process.emit(
			'message' as never,
			{
				topic: 'thaid-scan-session',
				action: 'expire',
				id: fakeId
			} as never
		);

		expect(getScanSession(fakeId)).toBeNull();
	});

	it('responds to init action by broadcasting active sessions', () => {
		const s1 = createScanSession(60);
		let sentMessage: unknown = null;
		const originalSend = (process as unknown as { send?: (msg: unknown) => void }).send;
		(process as unknown as { send?: (msg: unknown) => void }).send = (msg: unknown) => {
			sentMessage = msg;
		};

		try {
			process.emit(
				'message' as never,
				{
					topic: 'thaid-scan-session',
					action: 'init'
				} as never
			);

			expect(sentMessage).toMatchObject({
				topic: 'thaid-scan-session',
				action: 'init_sync',
				sessions: expect.arrayContaining([
					expect.objectContaining({
						id: s1.id,
						status: 'pending'
					})
				])
			});
		} finally {
			(process as unknown as { send?: (msg: unknown) => void }).send = originalSend;
		}
	});
});
