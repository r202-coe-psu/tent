import { describe, expect, it } from 'vitest';
import type { SmartCardData } from '$lib/features/kiosk-devices';
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

describe('walkInSession sources and phone', () => {
	it('a ThaiD walk-in holds only the session id and is ready once consented', () => {
		const session = createWalkInSession();
		session.beginThaid('a'.repeat(32));
		expect(session.source).toBe('thaid');
		expect(session.citizenId).toBeNull();
		expect(session.active).toBe(true);
		expect(session.identityReady).toBe(false);
		session.consent();
		expect(session.identityReady).toBe(true);
	});

	it('a card walk-in is ready only once the full card is held', () => {
		const session = consentedSession();
		expect(session.source).toBe('smart-card');
		expect(session.identityReady).toBe(false);
		session.holdCard(CARD, null);
		expect(session.identityReady).toBe(true);
	});

	it('starting another walk-in forgets the previous source and phone', () => {
		const session = createWalkInSession();
		session.beginThaid('a'.repeat(32));
		session.phone = '0812345678';
		session.begin(CARD.citizen_id);
		expect(session.thaidSessionId).toBeNull();
		expect(session.phone).toBeNull();
		session.clear();
		expect(session.source).toBeNull();
		expect(session.active).toBe(false);
	});
});

describe('walkInSession registration hand-over', () => {
	it('clear() and begin() forget the registration the done page prints from', () => {
		const session = consentedSession();
		session.registration = {
			evacuee_id: 'evacuee:01',
			qr_payload: 'qr-payload',
			label: { name: 'สมชาย ใจดี', phone: null }
		};
		session.clear();
		expect(session.registration).toBeNull();

		session.registration = {
			evacuee_id: 'evacuee:02',
			qr_payload: 'qr-payload-2',
			label: { name: 'สมหญิง ใจดี', phone: null }
		};
		session.begin(CARD.citizen_id);
		expect(session.registration).toBeNull();
	});
});

describe('walkInSession station start time (CR-192)', () => {
	it('stamps the card read / ThaiD verification as the walk-in start and forgets it on clear', () => {
		const session = createWalkInSession();
		expect(session.startedAt).toBeNull();

		const before = Date.now();
		session.begin('1234567890123');
		const cardStart = Date.parse(session.startedAt ?? '');
		expect(cardStart).toBeGreaterThanOrEqual(before);
		expect(cardStart).toBeLessThanOrEqual(Date.now());

		session.beginThaid('a'.repeat(32));
		expect(Date.parse(session.startedAt ?? '')).toBeGreaterThanOrEqual(cardStart);

		session.clear();
		expect(session.startedAt).toBeNull();
	});
});
