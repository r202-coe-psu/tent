import type { ConsentDecision } from '$lib/features/consent';
import type { SmartCardData } from '$lib/features/kiosk-devices';
import type { KioskRegistrationResult } from '../data/kiosk-check-in.api';
import type { FaceCheckOutcome } from '../domain/face-check';

/** The face check the walk-in face page runs, as the card page resolved it from the hardware. */
export type WalkInFaceCheck = { cameraLabel: string | null; cameraFlip: boolean };

/** How the walk-in proved who they are: the card in the reader, or a ThaiD scan. */
export type WalkInSource = 'smart-card' | 'thaid';

/**
 * Nothing known about the face check (the card page never said): run it anyway with the front
 * camera, so anything but a match waits for the staff PIN. The face page never skips the check.
 */
export const WALK_IN_FACE_CHECK_STRICT: WalkInFaceCheck = { cameraLabel: null, cameraFlip: false };

class WalkInSession {
	source = $state<WalkInSource | null>(null);
	/** Card walk-in only: the id read from the chip. A ThaiD id never reaches the browser. */
	citizenId = $state<string | null>(null);
	/** ThaiD walk-in only: the verified session the server registers from. */
	thaidSessionId = $state<string | null>(null);
	/** When the card was read / the ThaiD scan verified (ISO): the Station 1 `start` of the walk-in. */
	startedAt = $state<string | null>(null);
	consentDecision = $state.raw<ConsentDecision | null>(null);
	/** Why the consent page is asking again (the server found the decision too old); else null. */
	consentNotice = $state<string | null>(null);
	/** Why the ThaiD scan page is starting over (consent and the scan both expired); else null. */
	thaidRestartNotice = $state<string | null>(null);
	/** The full card read, kept in memory only while the face check runs, then submitted. */
	card = $state.raw<SmartCardData | null>(null);
	/** Set with `card` by the card page: the face check it found on for this machine. */
	faceCheck = $state.raw<WalkInFaceCheck | null>(null);
	faceOutcome = $state<FaceCheckOutcome | null>(null);
	/** Canonical phone typed on the phone step; `null` = none given (or not asked yet). */
	phone = $state<string | null>(null);
	/** What the register call returned (QR + label text): the done page prints it, then forgets it. */
	registration = $state.raw<KioskRegistrationResult | null>(null);

	get consented(): boolean {
		return this.consentDecision !== null;
	}

	/** A walk-in is under way (card or ThaiD). */
	get active(): boolean {
		return this.source === 'thaid' ? this.thaidSessionId !== null : this.citizenId !== null;
	}

	/** Who they are is settled: a ThaiD scan, or (card) the full chip read held for submitting. */
	get identityReady(): boolean {
		if (!this.active || !this.consented) return false;
		return this.source === 'thaid' || this.card !== null;
	}

	/** What the face page runs: the card page's face check, or the strict default when not known. */
	get faceCheckToRun(): WalkInFaceCheck {
		return this.faceCheck ?? WALK_IN_FACE_CHECK_STRICT;
	}

	begin(citizenId: string): void {
		this.reset();
		this.source = 'smart-card';
		this.citizenId = citizenId;
		this.startedAt = new Date().toISOString();
	}

	beginThaid(sessionId: string): void {
		this.reset();
		this.source = 'thaid';
		this.thaidSessionId = sessionId;
		this.startedAt = new Date().toISOString();
	}

	recordConsent(decision: ConsentDecision): void {
		if (!this.active) return;
		this.consentDecision = decision;
		this.consentNotice = null;
	}

	/**
	 * The server would not take the decision any more (too old): drop it so the consent page asks
	 * again, saying why. A card walk-in keeps who they are (card read, face check); a ThaiD scan
	 * has expired by then, so a ThaiD walk-in restarts with `restartThaid` instead.
	 */
	withdrawConsent(notice: string): void {
		if (!this.active) return;
		this.consentDecision = null;
		this.consentNotice = notice;
	}

	/** Forget the ThaiD walk-in and leave the notice the scan page shows when it starts over. */
	restartThaid(notice: string): void {
		this.reset();
		this.thaidRestartNotice = notice;
	}

	/** The scan page reads the restart notice once; it never reaches a later visitor. */
	takeThaidRestartNotice(): string | null {
		const notice = this.thaidRestartNotice;
		this.thaidRestartNotice = null;
		return notice;
	}

	/** Hold the card for the next steps, with the camera the card page found for the face check. */
	holdCard(card: SmartCardData, faceCheck: WalkInFaceCheck | null): void {
		this.card = card;
		this.faceCheck = faceCheck;
	}

	clear(): void {
		this.reset();
	}

	private reset(): void {
		this.source = null;
		this.citizenId = null;
		this.thaidSessionId = null;
		this.startedAt = null;
		this.consentDecision = null;
		this.consentNotice = null;
		this.thaidRestartNotice = null;
		this.card = null;
		this.faceCheck = null;
		this.faceOutcome = null;
		this.phone = null;
		this.registration = null;
	}
}

export const walkInSession = new WalkInSession();

/** A fresh session, for tests. */
export function createWalkInSession(): WalkInSession {
	return new WalkInSession();
}
