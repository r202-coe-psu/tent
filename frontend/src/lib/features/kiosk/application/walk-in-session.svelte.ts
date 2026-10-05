import type { SmartCardData } from '$lib/features/scanners';
import type { FaceCheckOutcome } from '../domain/face-check';

class WalkInSession {
	citizenId = $state<string | null>(null);
	consented = $state(false);
	consentedAt = $state<string | null>(null);
	/** The full card read, kept in memory only while the face check runs, then submitted. */
	card = $state.raw<SmartCardData | null>(null);
	faceOutcome = $state<FaceCheckOutcome | null>(null);

	begin(citizenId: string): void {
		this.citizenId = citizenId;
		this.consented = false;
		this.consentedAt = null;
		this.card = null;
		this.faceOutcome = null;
	}

	consent(): void {
		if (this.citizenId) {
			this.consented = true;
			this.consentedAt = new Date().toISOString();
		}
	}

	holdCard(card: SmartCardData): void {
		this.card = card;
	}

	clear(): void {
		this.citizenId = null;
		this.consented = false;
		this.consentedAt = null;
		this.card = null;
		this.faceOutcome = null;
	}
}

export const walkInSession = new WalkInSession();
