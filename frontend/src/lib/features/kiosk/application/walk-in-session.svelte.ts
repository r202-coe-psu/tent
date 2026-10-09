import type { SmartCardData } from '$lib/features/scanners';
import type { FaceCheckOutcome } from '../domain/face-check';

/** The face check the walk-in face page runs, as the card page resolved it from the hardware. */
export type WalkInFaceCheck = { cameraLabel: string | null };

/**
 * Nothing known about the face check (the card page never said): run it anyway with the front
 * camera, so anything but a match waits for the staff PIN. The face page never skips the check.
 */
export const WALK_IN_FACE_CHECK_STRICT: WalkInFaceCheck = { cameraLabel: null };

class WalkInSession {
	citizenId = $state<string | null>(null);
	consented = $state(false);
	consentedAt = $state<string | null>(null);
	/** The full card read, kept in memory only while the face check runs, then submitted. */
	card = $state.raw<SmartCardData | null>(null);
	/** Set with `card` by the card page: the face check it found on for this machine. */
	faceCheck = $state.raw<WalkInFaceCheck | null>(null);
	faceOutcome = $state<FaceCheckOutcome | null>(null);

	/** What the face page runs: the card page's face check, or the strict default when not known. */
	get faceCheckToRun(): WalkInFaceCheck {
		return this.faceCheck ?? WALK_IN_FACE_CHECK_STRICT;
	}

	begin(citizenId: string): void {
		this.citizenId = citizenId;
		this.consented = false;
		this.consentedAt = null;
		this.card = null;
		this.faceCheck = null;
		this.faceOutcome = null;
	}

	consent(): void {
		if (this.citizenId) {
			this.consented = true;
			this.consentedAt = new Date().toISOString();
		}
	}

	/** Hold the card for the face page, with the camera the card page found for the face check. */
	holdCard(card: SmartCardData, cameraLabel: string | null): void {
		this.card = card;
		this.faceCheck = { cameraLabel };
	}

	clear(): void {
		this.citizenId = null;
		this.consented = false;
		this.consentedAt = null;
		this.card = null;
		this.faceCheck = null;
		this.faceOutcome = null;
	}
}

export const walkInSession = new WalkInSession();

/** A fresh session, for tests. */
export function createWalkInSession(): WalkInSession {
	return new WalkInSession();
}
