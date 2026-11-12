import { describe, expect, it } from 'vitest';
import {
	FACE_HINTS,
	faceHintMessage,
	faceOutcomeMessage,
	faceRetryMessage,
	localizeFaceMessage,
	type FaceCheckOutcome
} from './face-check';

const THAI = /[฀-๿]/;

describe('face check wording in English', () => {
	it('words every camera hint in English', () => {
		for (const hint of FACE_HINTS) {
			const message = faceHintMessage(hint, 'en');
			expect(message).not.toMatch(THAI);
			expect(message.length).toBeGreaterThan(0);
		}
		expect(faceHintMessage('too_far', 'en')).toBe('Please move a little closer to the camera');
	});

	it('words every retry message in English, including "no match yet"', () => {
		for (const hint of FACE_HINTS) {
			expect(faceRetryMessage(hint, 'en')).not.toMatch(THAI);
		}
		expect(faceRetryMessage('ok', 'en')).toBe(
			'Your face does not match the card photo yet. Please look straight at the camera and try again'
		);
	});

	it('keeps Thai when no language is given', () => {
		expect(faceHintMessage('too_far')).toBe('กรุณาขยับเข้าใกล้กล้องอีกนิด');
		expect(faceRetryMessage('ok')).toBe(
			'ใบหน้ายังไม่ตรงกับรูปในบัตร กรุณามองตรงที่กล้องแล้วลองอีกครั้ง'
		);
	});

	it('words every non-match result in English with the same tone', () => {
		const outcomes: Exclude<FaceCheckOutcome, { kind: 'match' }>[] = [
			{ kind: 'not_confirmed', reason: 'liveness_failed' },
			{ kind: 'declined' },
			{ kind: 'skipped', reason: 'timeout' }
		];
		for (const outcome of outcomes) {
			const th = faceOutcomeMessage(outcome);
			const en = faceOutcomeMessage(outcome, 'en');
			expect(en.tone).toBe(th.tone);
			expect(`${en.title} ${en.detail}`).not.toMatch(THAI);
		}
		expect(faceOutcomeMessage({ kind: 'declined' }, 'en').detail).toContain('still get service');
	});

	it('turns a Thai camera message already held by the session into English', () => {
		expect(localizeFaceMessage(faceHintMessage('too_dark'), 'en')).toBe(
			faceHintMessage('too_dark', 'en')
		);
		expect(localizeFaceMessage(faceRetryMessage('ok'), 'en')).toBe(faceRetryMessage('ok', 'en'));
		expect(localizeFaceMessage(faceHintMessage('too_dark'), 'th')).toBe(
			faceHintMessage('too_dark')
		);
		expect(localizeFaceMessage('something else', 'en')).toBe('something else');
	});
});
