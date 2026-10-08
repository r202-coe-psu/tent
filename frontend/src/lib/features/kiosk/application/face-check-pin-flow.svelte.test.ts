import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KioskFaceApi } from '../data/kiosk-face.api';
import type { KioskStaffPinResult } from '../data/kiosk-staff-pin.api';
import {
	FACE_BYPASSED_BY_STAFF,
	FACE_MATCH_SHOWN_MS,
	type FaceCheckMode,
	type FaceCheckOutcome
} from '../domain/face-check';
import { FaceCheckPinFlow, type FaceCheckPinFlowSession } from './face-check-pin-flow.svelte';
import {
	FaceCheckSession,
	type FaceCamera,
	type FaceCheckPhase
} from './face-check-session.svelte';
import { StaffPinEntry, STAFF_PIN_IDLE_MS } from './staff-pin-entry.svelte';

const STAFF_BYPASS: FaceCheckOutcome = { kind: 'skipped', reason: FACE_BYPASSED_BY_STAFF };
const NOT_CONFIRMED: FaceCheckOutcome = { kind: 'not_confirmed', reason: 'low_score' };

afterEach(() => {
	vi.useRealTimers();
});

/** A session stub: the flow only holds, resumes, skips and reads the phase. */
function setup(mode: FaceCheckMode = 'on') {
	const session: FaceCheckPinFlowSession & { phase: FaceCheckPhase } = {
		phase: 'positioning',
		hold: vi.fn(),
		resume: vi.fn(),
		skip: vi.fn((reason?: string) => {
			session.phase = 'done';
			flow.finished(
				reason ? { kind: 'skipped', reason } : { kind: 'skipped', reason: 'user_skipped' }
			);
		})
	};
	const onfinish = vi.fn();
	const oncancel = vi.fn();
	const cancelCheck = vi.fn();
	const pinChanges: boolean[] = [];
	const flow = new FaceCheckPinFlow({
		mode: () => mode,
		cancelCheck,
		onfinish,
		oncancel,
		onpinchange: (open) => pinChanges.push(open)
	});
	flow.attach(session);
	return { flow, session, onfinish, oncancel, cancelCheck, pinChanges };
}

describe('FaceCheckPinFlow — result screen (mode on)', () => {
	it('waits for staff on a not-matched result instead of handing on', () => {
		const { flow, session, onfinish } = setup();
		session.phase = 'done';

		flow.finished(NOT_CONFIRMED);

		expect(onfinish).not.toHaveBeenCalled();
		expect(flow.pinOpen).toBe(false);
		expect(flow.handedOn).toBe(false);
	});

	it('not_confirmed → PIN → hands on as a staff bypass and tells the scanner client why', () => {
		const { flow, session, onfinish, cancelCheck, pinChanges } = setup();
		session.phase = 'done';
		flow.finished(NOT_CONFIRMED);

		flow.openFromResult();
		expect(flow.pinFrom).toBe('result');
		flow.pinVerified();

		expect(cancelCheck).toHaveBeenCalledExactlyOnceWith(FACE_BYPASSED_BY_STAFF);
		expect(onfinish).toHaveBeenCalledExactlyOnceWith(STAFF_BYPASS);
		expect(flow.handedOn).toBe(true);
		expect(flow.pinOpen).toBe(false);
		expect(pinChanges).toEqual([true, false]);
	});

	it('cancelling the PIN from the result screen goes home and saves nothing', () => {
		const { flow, session, onfinish, oncancel } = setup();
		session.phase = 'done';
		flow.finished(NOT_CONFIRMED);
		flow.openFromResult();

		expect(flow.pinCancelled()).toBeNull();

		expect(oncancel).toHaveBeenCalledOnce();
		expect(onfinish).not.toHaveBeenCalled();
		expect(flow.pinOpen).toBe(false);
	});

	it('does nothing on a cancel when the panel is not open', () => {
		const { flow, oncancel } = setup();

		expect(flow.pinCancelled()).toBeNull();
		expect(oncancel).not.toHaveBeenCalled();
	});
});

describe('FaceCheckPinFlow — from the camera', () => {
	it('holds the check while staff are on the PIN', () => {
		const { flow, session, pinChanges } = setup();

		flow.skip();

		expect(session.hold).toHaveBeenCalledOnce();
		expect(session.skip).not.toHaveBeenCalled();
		expect(flow.pinFrom).toBe('camera');
		expect(pinChanges).toEqual([true]);
	});

	it('a right PIN ends the check as a staff bypass, which hands on', () => {
		const { flow, session, onfinish, cancelCheck } = setup();
		flow.skip();

		flow.pinVerified();

		expect(session.skip).toHaveBeenCalledExactlyOnceWith(FACE_BYPASSED_BY_STAFF);
		expect(onfinish).toHaveBeenCalledExactlyOnceWith(STAFF_BYPASS);
		// The session told the scanner client itself.
		expect(cancelCheck).not.toHaveBeenCalled();
	});

	it('cancel resumes the check and puts focus back on the skip button', () => {
		const { flow, session, oncancel } = setup();
		flow.skip();

		expect(flow.pinCancelled()).toBe('skip');

		expect(session.resume).toHaveBeenCalledOnce();
		expect(oncancel).not.toHaveBeenCalled();
		expect(flow.pinOpen).toBe(false);
	});

	it('cancel after the check ended meanwhile shows the result screen again', () => {
		const { flow, session, oncancel } = setup();
		flow.skip();
		session.phase = 'done';
		flow.finished(NOT_CONFIRMED); // stays open: wait_for_pin

		expect(flow.pinOpen).toBe(true);
		expect(flow.pinCancelled()).toBe('continue');
		expect(session.resume).not.toHaveBeenCalled();
		expect(oncancel).not.toHaveBeenCalled();
	});

	it('closes the panel when the card came out: that is not a staff bypass', () => {
		const { flow, onfinish } = setup();
		flow.skip();

		flow.finished({ kind: 'skipped', reason: 'card_removed' });

		expect(flow.pinOpen).toBe(false);
		expect(onfinish).not.toHaveBeenCalled();
	});

	it('in shadow mode skips straight away and never asks for a PIN', () => {
		const { flow, session, onfinish } = setup('shadow');

		flow.skip();

		expect(session.hold).not.toHaveBeenCalled();
		expect(session.skip).toHaveBeenCalledExactlyOnceWith();
		expect(flow.pinOpen).toBe(false);
		expect(onfinish).toHaveBeenCalledOnce();
	});
});

describe('FaceCheckPinFlow — match', () => {
	it('shows the match for a moment, then hands on', () => {
		vi.useFakeTimers();
		const { flow, onfinish } = setup();

		flow.finished({ kind: 'match' });
		vi.advanceTimersByTime(FACE_MATCH_SHOWN_MS - 1);
		expect(onfinish).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);

		expect(onfinish).toHaveBeenCalledExactlyOnceWith({ kind: 'match' });
	});

	it('does not hand on after the page went away', () => {
		vi.useFakeTimers();
		const { flow, onfinish } = setup();

		flow.finished({ kind: 'match' });
		flow.destroy();
		vi.advanceTimersByTime(FACE_MATCH_SHOWN_MS * 2);

		expect(onfinish).not.toHaveBeenCalled();
	});
});

/** The real session (fake scanner client) driving the flow, with the real PIN panel state. */
function setupReal(verdict: 'not_confirmed' | 'match' = 'not_confirmed') {
	const camera: FaceCamera = {
		preview: vi.fn(async () => new Blob(['p'])),
		burst: vi.fn(async (count: number) => Array.from({ length: count }, () => new Blob(['b']))),
		stop: vi.fn()
	};
	const api: KioskFaceApi = {
		start: vi.fn(async () => ({ ok: true as const, reference: 'reading' as const })),
		frame: vi.fn(async () => ({ face: true, hint: 'ok' as const, ready: true })),
		verify: vi.fn(async () =>
			verdict === 'match'
				? { result: 'match' as const, attempt: 1 }
				: { result: 'not_confirmed' as const, reason: 'low_score', attempt: 3 }
		),
		cancel: vi.fn(async () => {})
	};
	const onfinish = vi.fn();
	const oncancel = vi.fn();
	const flow = new FaceCheckPinFlow({
		mode: () => 'on',
		cancelCheck: (reason) => void api.cancel(reason),
		onfinish,
		oncancel
	});
	const session = new FaceCheckSession({
		flow: 'walk_in',
		citizenId: '1234567890123',
		api,
		openCamera: async () => camera,
		onfinish: (outcome) => flow.finished(outcome),
		sleep: async () => {},
		now: () => 1_000_000
	});
	flow.attach(session);
	const verify = vi.fn<(pin: string) => Promise<KioskStaffPinResult>>(async () => ({
		kind: 'verified'
	}));
	/** What the face check mounts when `flow.pinOpen` turns true. */
	const openPin = () => {
		const entry = new StaffPinEntry({
			verify,
			onverified: () => flow.pinVerified(),
			oncancel: () => flow.pinCancelled()
		});
		entry.start();
		return entry;
	};
	return { flow, session, api, onfinish, oncancel, verify, openPin };
}

describe('FaceCheckPinFlow with FaceCheckSession and StaffPinEntry', () => {
	it('not_confirmed → staff PIN → onfinish(staff_bypass)', async () => {
		const { flow, session, api, onfinish, verify, openPin } = setupReal();
		await session.agree();

		expect(session.phase).toBe('done');
		expect(session.outcome).toEqual(NOT_CONFIRMED);
		expect(onfinish).not.toHaveBeenCalled();

		flow.openFromResult();
		const entry = openPin();
		for (const digit of '246810') entry.press(digit);
		await entry.confirm();

		expect(verify).toHaveBeenCalledExactlyOnceWith('246810');
		expect(onfinish).toHaveBeenCalledExactlyOnceWith(STAFF_BYPASS);
		expect(api.cancel).toHaveBeenLastCalledWith(FACE_BYPASSED_BY_STAFF);
		expect(entry.pin).toBe('');
	});

	it('a wrong PIN does not hand on', async () => {
		const { flow, session, onfinish, verify, openPin } = setupReal();
		await session.agree();
		flow.openFromResult();
		verify.mockResolvedValueOnce({ kind: 'wrong' });
		const entry = openPin();

		for (const digit of '000000') entry.press(digit);
		await entry.confirm();

		expect(entry.status.kind).toBe('wrong');
		expect(onfinish).not.toHaveBeenCalled();
		expect(flow.pinOpen).toBe(true);
	});

	it('cancel on the PIN goes home (oncancel), nothing handed on', async () => {
		const { flow, session, onfinish, oncancel, openPin } = setupReal();
		await session.agree();
		flow.openFromResult();
		const entry = openPin();

		entry.cancel();

		expect(oncancel).toHaveBeenCalledOnce();
		expect(onfinish).not.toHaveBeenCalled();
		expect(flow.pinOpen).toBe(false);
	});

	it('Esc on the PIN goes home the same way', async () => {
		const { flow, session, oncancel, openPin } = setupReal();
		await session.agree();
		flow.openFromResult();
		const entry = openPin();

		entry.press('Escape');

		expect(oncancel).toHaveBeenCalledOnce();
	});

	it('30 s without a touch on the PIN goes home', async () => {
		const { flow, session, oncancel, onfinish, openPin } = setupReal();
		await session.agree();
		vi.useFakeTimers();
		flow.openFromResult();
		openPin();

		vi.advanceTimersByTime(STAFF_PIN_IDLE_MS);

		expect(oncancel).toHaveBeenCalledOnce();
		expect(onfinish).not.toHaveBeenCalled();
	});
});
