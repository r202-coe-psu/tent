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
	/** The logged-in staff user; C5 shows only when set and the channel allows it (FR-15). */
	staff?: ConsentStaff | null;
	/** FR-12: true for new people, `initialSearchVisible(targets)` for existing ones. */
	initialSearchVisible?: boolean;
}

export type ConsentGate =
	| { kind: 'decided'; decision: ConsentDecision }
	| { kind: 'needs-basic-confirm' }
	| { kind: 'needs-guardian-pick' };

/**
 * UI state of one consent block (C1 to C5 plus the basic-mode notice). The host owns it and
 * asks it for a decision when its confirm runs. `eligibleKeys` are the C4 candidates in form
 * order: members other than the registrant that still need consent.
 */
export class ConsentBlockState {
	readonly channel: BlockChannel;
	readonly caps: SurfaceCaps;
	readonly staff: ConsentStaff | null;

	#full = $state(false);
	health = $state(false);
	searchVisible = $state(true);
	guardian = $state(false);
	guardianKeys = $state<string[]>([]);
	verbal = $state(false);
	noticeVisible = $state(false);

	/** Reused while the choice is unchanged, so a retried save writes the same ref (and ids). */
	#stamp: { fingerprint: string; stamp: ConsentStamp } | null = null;

	constructor(options: ConsentBlockOptions) {
		this.channel = options.channel;
		this.caps = SURFACE_CAPS[options.channel];
		this.staff = options.staff ?? null;
		this.searchVisible = options.initialSearchVisible ?? true;
	}

	get full(): boolean {
		return this.#full;
	}

	/** FR-18: ticking C1 while the notice shows brings the main actions back. */
	set full(value: boolean) {
		this.#full = value;
		if (value) this.noticeVisible = false;
	}

	get showsVerbal(): boolean {
		return this.caps.verbal && this.staff !== null;
	}

	setGuardianPick(key: string, picked: boolean): void {
		const rest = this.guardianKeys.filter((k) => k !== key);
		this.guardianKeys = picked ? [...rest, key] : rest;
	}

	guardianFor(eligibleKeys: readonly string[]): string[] {
		if (!this.caps.guardian || !this.guardian) return [];
		return eligibleKeys.filter((key) => this.guardianKeys.includes(key));
	}

	/** FR-14. With no eligible member C4 is hidden, so a stale tick cannot block the form. */
	canConfirm(eligibleKeys: readonly string[]): boolean {
		if (!this.caps.guardian || !this.guardian || eligibleKeys.length === 0) return true;
		return this.guardianFor(eligibleKeys).length > 0;
	}

	/** FR-16. */
	discardsMedical(hasMedicalInput: boolean): boolean {
		return hasMedicalInput && !(this.#full && this.health);
	}

	/** FR-17:「ไม่ยินยอม」. */
	decline(): void {
		this.noticeVisible = true;
	}

	/** FR-18:「กลับไปเลือกความยินยอม」. */
	backToChoosing(): void {
		this.noticeVisible = false;
	}

	/** The host's「ยืนยัน」. Without C1 (or after a decline) it opens the basic notice (FR-17). */
	confirm(eligibleKeys: readonly string[], now?: Date): ConsentGate {
		if (!this.canConfirm(eligibleKeys)) return { kind: 'needs-guardian-pick' };
		if (!this.#full || this.noticeVisible) {
			this.noticeVisible = true;
			return { kind: 'needs-basic-confirm' };
		}
		return { kind: 'decided', decision: this.#decide('full', eligibleKeys, now) };
	}

	/** 「ลงทะเบียนแบบพื้นฐาน」: C2 and C3 count as refused whatever their ticks (FR-11). */
	confirmBasic(eligibleKeys: readonly string[], now?: Date): ConsentGate {
		if (!this.canConfirm(eligibleKeys)) return { kind: 'needs-guardian-pick' };
		return { kind: 'decided', decision: this.#decide('basic', eligibleKeys, now) };
	}

	#decide(mode: 'full' | 'basic', eligibleKeys: readonly string[], now?: Date): ConsentDecision {
		const shared = {
			guardian_for: this.guardianFor(eligibleKeys),
			verbal: this.showsVerbal && this.verbal
		};
		const choice =
			mode === 'basic'
				? { mode, ...shared }
				: { mode, health: this.health, search_visible: this.searchVisible, ...shared };
		const fingerprint = JSON.stringify(choice);
		if (this.#stamp?.fingerprint !== fingerprint) {
			this.#stamp = { fingerprint, stamp: mintConsentStamp(now) };
		}
		return consentDecisionSchemaFor(this.channel).parse({ ...choice, ...this.#stamp.stamp });
	}
}
