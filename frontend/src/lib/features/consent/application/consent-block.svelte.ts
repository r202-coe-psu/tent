import {
	consentDecisionSchemaFor,
	mintConsentStamp,
	SURFACE_CAPS,
	type BlockChannel,
	type ConsentDecision,
	type ConsentStamp,
	type SurfaceCaps
} from '../domain/consent';

export interface ConsentStaff {
	name: string;
	userId: string;
}

export interface ConsentBlockOptions {
	channel: BlockChannel;
	staff?: ConsentStaff | null;
	initialSearchVisible?: boolean;
}

export type ConsentGate = { kind: 'decided'; decision: ConsentDecision } | { kind: 'needs-main' };

export class ConsentBlockState {
	readonly channel: BlockChannel;
	readonly caps: SurfaceCaps;
	readonly staff: ConsentStaff | null;

	full = $state(false);
	health = $state(false);
	searchVisible = $state(true);
	verbal = $state(false);

	/** Reused while the choice is unchanged, so a retried save writes the same ref (and ids). */
	#stamp: { fingerprint: string; stamp: ConsentStamp } | null = null;

	constructor(options: ConsentBlockOptions) {
		this.channel = options.channel;
		this.caps = SURFACE_CAPS[options.channel];
		this.staff = options.staff ?? null;
		this.searchVisible = options.initialSearchVisible ?? true;
	}

	get showsVerbal(): boolean {
		return this.caps.verbal && this.staff !== null;
	}

	/** FR-11: C1 is required on every channel. */
	get canConfirm(): boolean {
		return this.full;
	}

	/** FR-17: ticks C1–C3; never C5, which only staff can attest. */
	acceptAll(): void {
		this.full = true;
		this.health = true;
		this.searchVisible = true;
	}

	discardsMedical(hasMedicalInput: boolean): boolean {
		return hasMedicalInput && !(this.full && this.health);
	}

	confirm(now?: Date): ConsentGate {
		if (!this.full) return { kind: 'needs-main' };
		const choice = {
			mode: 'full' as const,
			health: this.health,
			search_visible: this.searchVisible,
			guardian_for: [],
			verbal: this.showsVerbal && this.verbal
		};
		const fingerprint = JSON.stringify(choice);
		if (this.#stamp?.fingerprint !== fingerprint) {
			this.#stamp = { fingerprint, stamp: mintConsentStamp(now) };
		}
		return {
			kind: 'decided',
			decision: consentDecisionSchemaFor(this.channel).parse({ ...choice, ...this.#stamp.stamp })
		};
	}
}
