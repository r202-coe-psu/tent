import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	createScanSession,
	getScanSession,
	completeScanSession,
	createKioskCheckInSession,
	getKioskSessionForDevice,
	completeKioskSession,
	consumeKioskSession,
	cancelKioskSession,
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

	describe('kiosk check-in sessions', () => {
		const KIOSK_A = { device_id: 'scanner-device:A', shelter_code: 'SH001' };
		const KIOSK_B = { device_id: 'scanner-device:B', shelter_code: 'SH001' };

		it('binds a pending kiosk session to the device that created it', () => {
			const session = createKioskCheckInSession(KIOSK_A);
			expect(session.kind).toBe('kiosk_check_in');
			expect(session.status).toBe('pending');
			expect(session.expiresAt - Date.now()).toBeLessThanOrEqual(300_000);
			expect(session.expiresAt - Date.now()).toBeGreaterThan(295_000);

			expect(getKioskSessionForDevice(session.id, KIOSK_A.device_id)?.id).toBe(session.id);
			expect(getKioskSessionForDevice(session.id, KIOSK_B.device_id)).toBeNull();
		});

		it('defaults existing scan sessions to member_scan, invisible to kiosk lookups', () => {
			const session = createScanSession(60);
			expect(session.kind).toBe('member_scan');
			expect(getKioskSessionForDevice(session.id, KIOSK_A.device_id)).toBeNull();
		});

		it('completes a pending kiosk session with citizen only and extends expiry to 180s', () => {
			vi.useFakeTimers();
			try {
				vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
				const session = createKioskCheckInSession(KIOSK_A);
				const onCompleted = vi.fn();
				session.emitter.on('completed', onCompleted);

				vi.setSystemTime(new Date('2026-10-10T10:04:00Z'));
				const ok = completeKioskSession(session.id, { pid: '1234567890123', sub: 'sub-1' });

				expect(ok).toBe(true);
				expect(onCompleted).toHaveBeenCalledTimes(1);
				const stored = getKioskSessionForDevice(session.id, KIOSK_A.device_id);
				expect(stored?.status).toBe('completed');
				expect(stored?.citizen).toEqual({ pid: '1234567890123', sub: 'sub-1' });
				expect(stored?.profile).toBeUndefined();
				expect(stored?.expiresAt).toBe(new Date('2026-10-10T10:07:00Z').getTime());
			} finally {
				vi.useRealTimers();
			}
		});

		it('keeps the two session kinds from being completed through each other', () => {
			const kiosk = createKioskCheckInSession(KIOSK_A);
			const member = createScanSession(60);

			expect(completeScanSession(kiosk.id, SAMPLE_PROFILE)).toBe(false);
			expect(kiosk.status).toBe('pending');
			expect(completeKioskSession(member.id, { pid: '1234567890123', sub: 'sub-1' })).toBe(false);
			expect(member.status).toBe('pending');
		});

		it('completes a kiosk session only once', () => {
			const session = createKioskCheckInSession(KIOSK_A);
			expect(completeKioskSession(session.id, { pid: '1234567890123', sub: 'sub-1' })).toBe(true);
			expect(completeKioskSession(session.id, { pid: '9999999999999', sub: 'sub-2' })).toBe(false);
			expect(session.citizen).toEqual({ pid: '1234567890123', sub: 'sub-1' });
		});

		it('consumes a completed session once, for its own device only', () => {
			const session = createKioskCheckInSession(KIOSK_A);
			const citizen = { pid: '1234567890123', sub: 'sub-1' };
			expect(consumeKioskSession(session.id, KIOSK_A.device_id)).toBeNull(); // still pending

			completeKioskSession(session.id, citizen);
			expect(consumeKioskSession(session.id, KIOSK_B.device_id)).toBeNull();
			expect(getKioskSessionForDevice(session.id, KIOSK_A.device_id)?.status).toBe('completed');

			expect(consumeKioskSession(session.id, KIOSK_A.device_id)).toEqual(citizen);
			expect(getKioskSessionForDevice(session.id, KIOSK_A.device_id)?.status).toBe('consumed');
			expect(consumeKioskSession(session.id, KIOSK_A.device_id)).toBeNull();
		});

		it('cancels idempotently for its own device and blocks later completion', () => {
			const session = createKioskCheckInSession(KIOSK_A);

			cancelKioskSession(session.id, KIOSK_B.device_id);
			expect(session.status).toBe('pending');

			cancelKioskSession(session.id, KIOSK_A.device_id);
			cancelKioskSession(session.id, KIOSK_A.device_id);
			expect(getKioskSessionForDevice(session.id, KIOSK_A.device_id)?.status).toBe('cancelled');
			expect(completeKioskSession(session.id, { pid: '1234567890123', sub: 'sub-1' })).toBe(false);
		});

		it('cancels a completed session so its citizen can no longer be consumed', () => {
			const session = createKioskCheckInSession(KIOSK_A);
			completeKioskSession(session.id, { pid: '1234567890123', sub: 'sub-1' });

			cancelKioskSession(session.id, KIOSK_A.device_id);
			expect(consumeKioskSession(session.id, KIOSK_A.device_id)).toBeNull();
		});

		it('cancels the previous pending session when the same device creates a new one', () => {
			const first = createKioskCheckInSession(KIOSK_A);
			const otherDevice = createKioskCheckInSession(KIOSK_B);
			const second = createKioskCheckInSession(KIOSK_A);

			expect(getKioskSessionForDevice(first.id, KIOSK_A.device_id)?.status).toBe('cancelled');
			expect(second.status).toBe('pending');
			expect(otherDevice.status).toBe('pending');
		});

		it('removes cancelled sessions once their expiry passes', () => {
			vi.useFakeTimers();
			try {
				vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
				const session = createKioskCheckInSession(KIOSK_A);
				cancelKioskSession(session.id, KIOSK_A.device_id);

				vi.setSystemTime(new Date('2026-10-10T10:04:59Z'));
				expect(getKioskSessionForDevice(session.id, KIOSK_A.device_id)?.status).toBe('cancelled');
				vi.setSystemTime(new Date('2026-10-10T10:05:01Z'));
				expect(getKioskSessionForDevice(session.id, KIOSK_A.device_id)).toBeNull();
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('kiosk sessions over cluster IPC', () => {
		const KIOSK_A = { device_id: 'scanner-device:A', shelter_code: 'SH001' };
		const CITIZEN = { pid: '1234567890123', sub: 'sub-1' };
		type Sender = { send?: (msg: unknown) => void };

		function captureBroadcasts(): { sent: unknown[]; restore: () => void } {
			const sent: unknown[] = [];
			const original = (process as unknown as Sender).send;
			(process as unknown as Sender).send = (msg: unknown) => {
				sent.push(msg);
			};
			return {
				sent,
				restore: () => {
					(process as unknown as Sender).send = original;
				}
			};
		}

		function receive(msg: Record<string, unknown>) {
			process.emit('message' as never, { topic: 'thaid-scan-session', ...msg } as never);
		}

		it('broadcasts create, complete, consume and cancel with the new fields', () => {
			const spy = captureBroadcasts();
			try {
				const first = createKioskCheckInSession(KIOSK_A);
				completeKioskSession(first.id, CITIZEN);
				consumeKioskSession(first.id, KIOSK_A.device_id);
				const second = createKioskCheckInSession(KIOSK_A);
				cancelKioskSession(second.id, KIOSK_A.device_id);

				expect(spy.sent).toEqual([
					{
						topic: 'thaid-scan-session',
						action: 'create',
						session: {
							id: first.id,
							kind: 'kiosk_check_in',
							createdAt: first.createdAt,
							expiresAt: first.createdAt + 300_000,
							status: 'pending',
							binding: KIOSK_A
						}
					},
					{
						topic: 'thaid-scan-session',
						action: 'complete',
						id: first.id,
						citizen: CITIZEN,
						expiresAt: first.expiresAt
					},
					{ topic: 'thaid-scan-session', action: 'consume', id: first.id },
					expect.objectContaining({
						action: 'create',
						session: expect.objectContaining({ id: second.id })
					}),
					{ topic: 'thaid-scan-session', action: 'cancel', id: second.id }
				]);
			} finally {
				spy.restore();
			}
		});

		it('replays create, complete, consume and cancel received from another worker', () => {
			const now = Date.now();
			const base = { kind: 'kiosk_check_in', createdAt: now, expiresAt: now + 300_000 };
			receive({
				action: 'create',
				session: { id: 'ipc-1', ...base, status: 'pending', binding: KIOSK_A }
			});
			receive({
				action: 'create',
				session: { id: 'ipc-2', ...base, status: 'pending', binding: KIOSK_A }
			});

			const done = now + 180_000;
			receive({ action: 'complete', id: 'ipc-1', citizen: CITIZEN, expiresAt: done });
			const completed = getKioskSessionForDevice('ipc-1', KIOSK_A.device_id);
			expect(completed?.status).toBe('completed');
			expect(completed?.citizen).toEqual(CITIZEN);
			expect(completed?.expiresAt).toBe(done);

			receive({ action: 'consume', id: 'ipc-1' });
			expect(getKioskSessionForDevice('ipc-1', KIOSK_A.device_id)?.status).toBe('consumed');

			receive({ action: 'cancel', id: 'ipc-2' });
			expect(getKioskSessionForDevice('ipc-2', KIOSK_A.device_id)?.status).toBe('cancelled');
		});

		it('includes kiosk binding, citizen and non-pending status when answering init', () => {
			const session = createKioskCheckInSession(KIOSK_A);
			completeKioskSession(session.id, CITIZEN);
			const spy = captureBroadcasts();
			try {
				receive({ action: 'init' });
				expect(spy.sent).toEqual([
					{
						topic: 'thaid-scan-session',
						action: 'init_sync',
						sessions: [
							{
								id: session.id,
								kind: 'kiosk_check_in',
								createdAt: session.createdAt,
								expiresAt: session.expiresAt,
								status: 'completed',
								profile: undefined,
								citizen: CITIZEN,
								binding: KIOSK_A
							}
						]
					}
				]);
			} finally {
				spy.restore();
			}
		});

		it('restores kiosk sessions from init_sync', () => {
			const now = Date.now();
			receive({
				action: 'init_sync',
				sessions: [
					{
						id: 'sync-1',
						kind: 'kiosk_check_in',
						createdAt: now,
						expiresAt: now + 100_000,
						status: 'completed',
						citizen: CITIZEN,
						binding: KIOSK_A
					}
				]
			});
			expect(consumeKioskSession('sync-1', KIOSK_A.device_id)).toEqual(CITIZEN);
		});
	});
});
