import { describe, expect, it } from 'vitest';
import {
	FACE_CHECK_OFF,
	FACE_HINTS,
	FACE_SKIPPED_BY_PERSON,
	classifyFaceFailure,
	faceOutcomeIsPersonalChoice,
	faceStartReplySchema,
	faceFrameReplySchema,
	faceHintMessage,
	faceOutcomeNeedsStaff,
	faceRetryMessage,
	faceVerifyReplySchema,
	isFaceCheckEnabled,
	parseFaceCheckConfig
} from './face-check';

describe('parseFaceCheckConfig', () => {
	it('reads the mode and the enabled flows', () => {
		expect(parseFaceCheckConfig({ mode: 'shadow', flows: ['walk_in'] })).toEqual({
			mode: 'shadow',
			flows: ['walk_in']
		});
		expect(parseFaceCheckConfig({ mode: 'on', flows: ['check_in', 'walk_in'] }).mode).toBe('on');
	});

	it('means off for anything missing, unknown or off', () => {
		for (const value of [
			undefined,
			null,
			'on',
			{},
			{ mode: 'maybe', flows: [] },
			{ mode: 'on', flows: ['qr'] },
			{ mode: 'on' },
			{ mode: 'off', flows: ['walk_in'] }
		]) {
			expect(parseFaceCheckConfig(value)).toEqual(FACE_CHECK_OFF);
		}
	});
});

describe('isFaceCheckEnabled', () => {
	it('needs the mode on or shadow and the flow listed', () => {
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
});

describe('wording', () => {
	it('has a message for every hint the scanner client can send', () => {
		for (const hint of FACE_HINTS) expect(faceHintMessage(hint).length).toBeGreaterThan(5);
	});

	it('asks for a plain retry when nothing specific is wrong', () => {
		expect(faceRetryMessage('ok')).toContain('ลองอีกครั้ง');
		expect(faceRetryMessage('too_far')).toBe(faceHintMessage('too_far'));
	});

	it('never accuses the person', () => {
		for (const hint of FACE_HINTS) {
			expect(faceHintMessage(hint)).not.toMatch(/ปลอม|ไม่ตรง|ผิด/);
		}
	});
});

describe('faceOutcomeNeedsStaff', () => {
	it('sends everything but a match to staff', () => {
		expect(faceOutcomeNeedsStaff({ kind: 'match' })).toBe(false);
		for (const outcome of [
			{ kind: 'not_confirmed', reason: 'x' },
			{ kind: 'skipped', reason: 'x' },
			{ kind: 'declined' },
			{ kind: 'unavailable' }
		] as const) {
			expect(faceOutcomeNeedsStaff(outcome)).toBe(true);
		}
	});
});

describe('faceOutcomeIsPersonalChoice', () => {
	it('is true when the person declined or pressed skip themselves', () => {
		expect(faceOutcomeIsPersonalChoice({ kind: 'declined' })).toBe(true);
		expect(faceOutcomeIsPersonalChoice({ kind: 'skipped', reason: FACE_SKIPPED_BY_PERSON })).toBe(
			true
		);
	});

	it('is false when the system skipped, could not confirm or failed', () => {
		for (const outcome of [
			{ kind: 'match' },
			{ kind: 'not_confirmed', reason: FACE_SKIPPED_BY_PERSON },
			{ kind: 'skipped', reason: 'timeout' },
			{ kind: 'skipped', reason: 'no_chip_photo' },
			{ kind: 'unavailable' },
			{ kind: 'unavailable', reason: 'camera_denied' }
		] as const) {
			expect(faceOutcomeIsPersonalChoice(outcome)).toBe(false);
		}
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
