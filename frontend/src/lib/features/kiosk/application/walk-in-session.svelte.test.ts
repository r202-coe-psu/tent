import { describe, expect, it } from 'vitest';
import type { SmartCardData } from '$lib/features/kiosk-devices';
import { mintConsentStamp, type ConsentDecision } from '$lib/features/consent/server';
import { createWalkInSession, WALK_IN_FACE_CHECK_STRICT } from './walk-in-session.svelte';

const CARD = { citizen_id: '1234567890123' } as SmartCardData;
const DECISION: ConsentDecision = {
	mode: 'full',
	health: false,
	search_visible: true,
	guardian_for: [],
	verbal: false,
	...mintConsentStamp()
};

function consentedSession() {
	const session = createWalkInSession();
	session.begin(CARD.citizen_id);
	session.recordConsent(DECISION);
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
		expect(session.consentDecision).toBeNull();
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
		session.recordConsent(DECISION);
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

describe('walkInSession consent', () => {
	it('keeps the decision for the registration, and only once a walk-in is under way', () => {
		const session = createWalkInSession();
		session.recordConsent(DECISION);
		expect(session.consented).toBe(false);

		session.begin(CARD.citizen_id);
		session.recordConsent(DECISION);
		expect(session.consented).toBe(true);
		expect(session.consentDecision).toBe(DECISION);
	});

	it('starting another walk-in drops the previous decision', () => {
		const session = consentedSession();
		session.begin('9876543210987');
		expect(session.consented).toBe(false);
		expect(session.consentDecision).toBeNull();
	});

	it('withdrawing a stale decision asks again but keeps who they are', () => {
		const session = consentedSession();
		session.holdCard(CARD, null);
		session.phone = '0812345678';

		session.withdrawConsent('การยินยอมหมดเวลาแล้ว');
		expect(session.consentDecision).toBeNull();
		expect(session.consentNotice).toBe('การยินยอมหมดเวลาแล้ว');
		expect(session.identityReady).toBe(false);
		expect(session.active).toBe(true);
		expect(session.card).toBe(CARD);

		session.recordConsent(DECISION);
		expect(session.consentNotice).toBeNull();
		expect(session.identityReady).toBe(true);
	});

	it('withdrawing does nothing without a walk-in, and clear() forgets the notice', () => {
		const idle = createWalkInSession();
		idle.withdrawConsent('การยินยอมหมดเวลาแล้ว');
		expect(idle.consentNotice).toBeNull();

		const session = consentedSession();
		session.withdrawConsent('การยินยอมหมดเวลาแล้ว');
		session.clear();
		expect(session.consentNotice).toBeNull();
	});
});

describe('walkInSession registration hand-over', () => {
	it('clear() and begin() forget the registration the done page prints from', () => {
		const session = consentedSession();
		session.registration = {
			evacuee_id: 'evacuee:01',
			qr_payload: 'qr-payload',
			label: { name: 'สมชาย ใจดี', phone: null },
			consent_ref: DECISION.ref,
			consent_mode: 'full'
		};
		session.clear();
		expect(session.registration).toBeNull();

		session.registration = {
			evacuee_id: 'evacuee:02',
			qr_payload: 'qr-payload-2',
			label: { name: 'สมหญิง ใจดี', phone: null },
			consent_ref: DECISION.ref,
			consent_mode: 'full'
		};
		session.begin(CARD.citizen_id);
		expect(session.registration).toBeNull();
	});
});
