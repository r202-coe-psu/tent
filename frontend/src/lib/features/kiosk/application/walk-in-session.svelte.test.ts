import { describe, expect, it } from 'vitest';
import type { SmartCardData } from '$lib/features/scanners';
import { createWalkInSession, WALK_IN_FACE_CHECK_STRICT } from './walk-in-session.svelte';

const CARD = { citizen_id: '1234567890123' } as SmartCardData;

function consentedSession() {
	const session = createWalkInSession();
	session.begin(CARD.citizen_id);
	session.consent();
	return session;
}

describe('walkInSession face check hand-over', () => {
	it('carries the camera the card page resolved', () => {
		const session = consentedSession();
		session.holdCard(CARD, { cameraLabel: 'Front cam', cameraFlip: true });
		expect(session.card).toBe(CARD);
		expect(session.faceCheckToRun).toEqual({ cameraLabel: 'Front cam', cameraFlip: true });

		session.holdCard(CARD, { cameraLabel: null, cameraFlip: false });
		expect(session.faceCheckToRun).toEqual({ cameraLabel: null, cameraFlip: false });
	});

	it('still runs the check (staff PIN for anything but a match) when nothing was handed over', () => {
		const session = consentedSession();
		expect(session.faceCheck).toBeNull();
		expect(session.faceCheckToRun).toEqual(WALK_IN_FACE_CHECK_STRICT);
	});

	it('clear() and begin() forget the card, the photo and the face check', () => {
		const session = consentedSession();
		session.holdCard(CARD, { cameraLabel: 'Front cam', cameraFlip: false });
		session.faceOutcome = { kind: 'match' };
		session.clear();
		expect(session.citizenId).toBeNull();
		expect(session.consented).toBe(false);
		expect(session.card).toBeNull();
		expect(session.faceCheck).toBeNull();
		expect(session.faceOutcome).toBeNull();
		expect(session.faceCheckToRun).toEqual(WALK_IN_FACE_CHECK_STRICT);

		session.begin(CARD.citizen_id);
		session.holdCard(CARD, WALK_IN_FACE_CHECK_STRICT);
		session.begin('9876543210987');
		expect(session.card).toBeNull();
		expect(session.faceCheck).toBeNull();
	});
});
