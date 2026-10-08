import type { SmartCardData } from '$lib/features/scanners';
import type { FaceCheckMode, FaceCheckOutcome } from '../domain/face-check';

/** The face check the walk-in face page runs, as the card page resolved it from the hardware. */
export type WalkInFaceCheck = { mode: 'shadow' | 'on'; cameraLabel: string | null };

/**
 * Nothing known about the face check (the card page never said): run it in mode `on`, so anything
 * but a match waits for the staff PIN. The face page never skips the check by itself.
 */
export const WALK_IN_FACE_CHECK_STRICT: WalkInFaceCheck = { mode: 'on', cameraLabel: null };

class WalkInSession {
	citizenId = $state<string | null>(null);
	consented = $state(false);
	consentedAt = $state<string | null>(null);
	/** The full card read, kept in memory only while the face check runs, then submitted. */
	card = $state.raw<SmartCardData | null>(null);
	/** Set with `card` by the card page: the face check it found on for this machine. */
	faceCheck = $state.raw<WalkInFaceCheck | null>(null);
	faceOutcome = $state<FaceCheckOutcome | null>(null);

	/** What the face page runs: the card page's face check, or mode `on` when it is not known. */
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

	/**
	 * Hold the card for the face page, with the face check the card page found on. Only `shadow`
	 * stays shadow: any other mode (the card page only gets here with the check on) runs as `on`.
	 */
	holdCard(card: SmartCardData, faceMode: FaceCheckMode, cameraLabel: string | null): void {
		this.card = card;
		this.faceCheck = { mode: faceMode === 'shadow' ? 'shadow' : 'on', cameraLabel };
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
