import { describe, expect, it } from 'vitest';
import {
	FACE_BYPASSED_BY_STAFF,
	FACE_CHECK_OFF,
	FACE_HINTS,
	FACE_SKIPPED_BY_PERSON,
	classifyFaceFailure,
	faceOutcomeAction,
	faceStartReplySchema,
	faceFrameReplySchema,
	faceHintMessage,
	faceOutcomeMessage,
	faceOutcomeNeedsStaffPin,
	faceRetryMessage,
	faceVerifyReplySchema,
	isFaceCheckEnabled,
	parseFaceCheckConfig,
	staffPinCancelAction,
	type FaceCheckOutcome
} from './face-check';

describe('parseFaceCheckConfig', () => {
	it('reads the mode and the enabled flows', () => {
		expect(parseFaceCheckConfig({ mode: 'on', flows: ['walk_in'] })).toEqual({
			mode: 'on',
			flows: ['walk_in']
		});
	});

	it('means off for anything missing, unknown or off', () => {
		for (const value of [
			undefined,
			null,
			'on',
			{},
			{ mode: 'maybe', flows: [] },
			// removed mode: an older scanner client still sending it gets no face check
			{ mode: 'shadow', flows: ['walk_in'] },
			{ mode: 'on', flows: ['qr'] },
			{ mode: 'on' },
			{ mode: 'off', flows: ['walk_in'] }
		]) {
			expect(parseFaceCheckConfig(value)).toEqual(FACE_CHECK_OFF);
		}
	});
});

describe('isFaceCheckEnabled', () => {
	it('needs the mode on and the flow listed', () => {
		const config = parseFaceCheckConfig({ mode: 'on', flows: ['walk_in'] });
		expect(isFaceCheckEnabled(config, 'walk_in')).toBe(true);
		expect(isFaceCheckEnabled(config, 'check_in')).toBe(false);
		expect(isFaceCheckEnabled(FACE_CHECK_OFF, 'walk_in')).toBe(false);
	});
});

describe('replies from the scanner client', () => {
	it('accepts a frame reply with a known hint only', () => {
		expect(faceFrameReplySchema.safeParse({ face: true, hint: 'ok', ready: true }).success).toBe(
			true
		);
		expect(faceFrameReplySchema.safeParse({ face: true, hint: 'dizzy', ready: true }).success).toBe(
			false
		);
		expect(faceFrameReplySchema.safeParse({ face: true, hint: 'ok' }).success).toBe(false);
	});

	it('reads the chip-photo state on a frame reply when the scanner client sends it', () => {
		const base = { face: true, hint: 'ok', ready: true };
		for (const reference of ['reading', 'ready', 'unavailable']) {
			expect(faceFrameReplySchema.parse({ ...base, reference }).reference).toBe(reference);
		}
		expect(faceFrameReplySchema.parse(base).reference).toBeUndefined();
		expect(faceFrameReplySchema.safeParse({ ...base, reference: 'gone' }).success).toBe(false);
	});

	it('reads the attempt limit on a start reply, which must be at least 1 when sent', () => {
		const base = { ok: true, reference: 'reading' };
		expect(faceStartReplySchema.parse({ ...base, max_attempts: 5 }).max_attempts).toBe(5);
		expect(faceStartReplySchema.parse(base).max_attempts).toBeUndefined();
		for (const max_attempts of [0, -1, 2.5, '3']) {
			expect(faceStartReplySchema.safeParse({ ...base, max_attempts }).success).toBe(false);
		}
	});

	it('accepts each verdict shape and nothing else', () => {
		for (const reply of [
			{ result: 'match', attempt: 1 },
			{ result: 'retry', hint: 'too_far', attempt: 1 },
			{ result: 'not_confirmed', reason: 'retry_exhausted', attempt: 3 },
			{ result: 'skipped', reason: 'no_chip_photo', attempt: 0 }
		]) {
			expect(faceVerifyReplySchema.safeParse(reply).success).toBe(true);
		}
		for (const reply of [
			{ result: 'match' },
			{ result: 'retry', attempt: 1 },
			{ result: 'maybe', attempt: 1 },
			{ result: 'match', attempt: -1 }
		]) {
			expect(faceVerifyReplySchema.safeParse(reply).success).toBe(false);
		}
	});

	it('reads the chip photo on a match when the scanner client sends one', () => {
		const reply = faceVerifyReplySchema.parse({ result: 'match', attempt: 1, chip_photo: 'AAAA' });
		expect(reply).toEqual({ result: 'match', attempt: 1, chip_photo: 'AAAA' });
		expect(faceVerifyReplySchema.parse({ result: 'match', attempt: 1 })).not.toHaveProperty(
			'chip_photo'
		);
		expect(
			faceVerifyReplySchema.safeParse({ result: 'match', attempt: 1, chip_photo: '' }).success
		).toBe(false);
	});
});

describe('wording', () => {
	it('has a message for every hint the scanner client can send', () => {
		for (const hint of FACE_HINTS) expect(faceHintMessage(hint).length).toBeGreaterThan(5);
	});

	it('says the face does not match the card yet when nothing specific is wrong', () => {
		expect(faceRetryMessage('ok')).toBe(
			'ใบหน้ายังไม่ตรงกับรูปในบัตร กรุณามองตรงที่กล้องแล้วลองอีกครั้ง'
		);
		expect(faceRetryMessage('too_far')).toBe(faceHintMessage('too_far'));
	});

	it('never accuses the person', () => {
		for (const hint of FACE_HINTS) {
			expect(faceHintMessage(hint)).not.toMatch(/ปลอม|ไม่ตรง|ผิด/);
		}
	});
});

const NOT_MATCHES: Exclude<FaceCheckOutcome, { kind: 'match' }>[] = [
	{ kind: 'not_confirmed', reason: 'retry_exhausted' },
	{ kind: 'skipped', reason: FACE_SKIPPED_BY_PERSON },
	{ kind: 'skipped', reason: 'timeout' },
	{ kind: 'skipped', reason: 'no_chip_photo' },
	{ kind: 'declined' },
	{ kind: 'unavailable', reason: 'camera_failed' }
];

describe('faceOutcomeNeedsStaffPin', () => {
	it('lets only a match carry on by itself', () => {
		expect(faceOutcomeNeedsStaffPin({ kind: 'match' })).toBe(false);
		expect(faceOutcomeNeedsStaffPin({ kind: 'match', chipPhoto: 'AAAA' })).toBe(false);
		for (const outcome of NOT_MATCHES) expect(faceOutcomeNeedsStaffPin(outcome)).toBe(true);
	});

	it('asks for declining too: it is not a way around the check', () => {
		expect(faceOutcomeNeedsStaffPin({ kind: 'declined' })).toBe(true);
	});
});

describe('faceOutcomeAction', () => {
	const STAFF_BYPASS: FaceCheckOutcome = { kind: 'skipped', reason: FACE_BYPASSED_BY_STAFF };
	const CARD_REMOVED: FaceCheckOutcome = { kind: 'skipped', reason: 'card_removed' };

	it('carries on only after a match or a staff PIN', () => {
		expect(faceOutcomeAction({ kind: 'match' })).toBe('show_match');
		expect(faceOutcomeAction({ kind: 'match', chipPhoto: 'AAAA' })).toBe('show_match');
		expect(faceOutcomeAction(STAFF_BYPASS)).toBe('hand_on');
		for (const outcome of [...NOT_MATCHES, CARD_REMOVED]) {
			expect(['wait_for_pin', 'close_pin']).toContain(faceOutcomeAction(outcome));
		}
	});

	it('waits for the PIN after every other ending, declining and skipping included', () => {
		for (const outcome of NOT_MATCHES) expect(faceOutcomeAction(outcome)).toBe('wait_for_pin');
	});

	it('closes an open PIN panel when the card came out: that is not a staff bypass', () => {
		expect(faceOutcomeAction(CARD_REMOVED)).toBe('close_pin');
	});
});

describe('staffPinCancelAction', () => {
	it('goes home when cancelled from the result screen, whatever the check did', () => {
		expect(staffPinCancelAction('result', true)).toBe('go_home');
		expect(staffPinCancelAction('result', false)).toBe('go_home');
	});

	it('resumes the check when cancelled at the camera', () => {
		expect(staffPinCancelAction('camera', false)).toBe('resume');
	});

	it('shows the result when the check ended while staff were on the PIN', () => {
		expect(staffPinCancelAction('camera', true)).toBe('show_result');
	});
});

describe('faceOutcomeMessage', () => {
	it('says plainly that the face does not match only when it was compared', () => {
		expect(faceOutcomeMessage({ kind: 'not_confirmed', reason: 'liveness_failed' })).toEqual({
			tone: 'not_confirmed',
			title: 'ใบหน้าไม่ตรงกับรูปในบัตรประชาชน',
			detail: 'กรุณาติดต่อเจ้าหน้าที่เพื่อตรวจสอบตัวตน'
		});
	});

	it('never says "does not match" when nothing was compared', () => {
		for (const outcome of NOT_MATCHES.filter((value) => value.kind !== 'not_confirmed')) {
			const { title, detail } = faceOutcomeMessage(outcome);
			expect(`${title} ${detail}`).not.toContain('ไม่ตรง');
			expect(`${title} ${detail}`).toContain('กรุณาติดต่อเจ้าหน้าที่');
		}
		expect(faceOutcomeMessage({ kind: 'skipped', reason: 'timeout' }).title).toBe(
			'ระบบตรวจใบหน้าไม่ได้'
		);
	});

	it('words declining as service, not a failure', () => {
		const message = faceOutcomeMessage({ kind: 'declined' });
		expect(message.tone).toBe('declined');
		expect(`${message.title} ${message.detail}`).not.toMatch(/ไม่ได้|ไม่ตรง|ผิด|ปฏิเสธ/);
		expect(message.detail).toContain('ท่านยังรับบริการได้ตามปกติ');
	});
});

describe('classifyFaceFailure', () => {
	it.each([
		['NotAllowedError', 'camera_denied'],
		['SecurityError', 'camera_denied'],
		['NotFoundError', 'camera_not_found'],
		['OverconstrainedError', 'camera_not_found'],
		['DevicesNotFoundError', 'camera_not_found'],
		['NotReadableError', 'camera_failed'],
		['AbortError', 'camera_failed'],
		['TimeoutError', 'scanner_unreachable']
	] as const)('sorts a browser %s as %s', (name, reason) => {
		expect(classifyFaceFailure(new DOMException('x', name))).toBe(reason);
	});

	it('treats a failed scanner client request, a dropped fetch and a timeout as unreachable', () => {
		const refused = Object.assign(new Error('face check request failed (503)'), {
			name: 'KioskFaceError'
		});
		expect(classifyFaceFailure(refused)).toBe('scanner_unreachable');
		expect(classifyFaceFailure(new TypeError('Failed to fetch'))).toBe('scanner_unreachable');
	});

	it('calls any other error, or a non-error, a camera failure', () => {
		expect(classifyFaceFailure(new Error('camera has no picture yet'))).toBe('camera_failed');
		for (const value of [undefined, null, 'boom', 42, {}]) {
			expect(classifyFaceFailure(value)).toBe('camera_failed');
		}
	});
});
