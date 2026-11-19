import {
	initialCheckoutSelection,
	isSelfCheckoutEligible,
	type KioskCheckoutDestination
} from '../domain/self-checkout';
import {
	KioskRequestError,
	type GateInput,
	type KioskEvacueeSummary
} from '../data/kiosk-check-in.api';
import type {
	KioskCheckOutInput,
	KioskCheckOutMemberResult,
	KioskCheckOutResult
} from '../data/kiosk-check-out.api';

export type SelfCheckoutStep =
	'ask' | 'members' | 'destination' | 'confirm' | 'submitting' | 'done';

/** The one server call, injected so the step logic never touches `fetch` or the DOM. */
export interface SelfCheckoutDeps {
	checkOut(input: KioskCheckOutInput): Promise<KioskCheckOutResult>;
}

/** Seconds the done screen stays up before the kiosk goes back to the home screen. */
export const SELF_CHECKOUT_RETURN_SECONDS = 15;

/** Answers a retry of the same request cannot change: the visitor can only go home or to staff. */
const TERMINAL_ERROR_CODES: ReadonlySet<string> = new Set([
	'KIOSK_CHECK_OUT_IDENTITY_MISMATCH',
	'KIOSK_THAID_SESSION_INVALID',
	'KIOSK_METHOD_DISABLED'
]);

/**
 * #1401: a visitor already in the shelter checks themselves (and chosen household members) out at
 * the kiosk. ask → members → destination → confirm → submitting → done. There is no face check
 * anywhere in this flow: the card or ThaiD scan that opened it is the only proof, and the server
 * checks it again against the record.
 */
export class SelfCheckoutSession {
	step = $state<SelfCheckoutStep>('ask');
	selectedIds = $state<string[]>([]);
	destination = $state<KioskCheckoutDestination | null>(null);
	/**
	 * The last submit failed. `message` is the server's (already in the visitor's language), or
	 * null for a failure with no answer so the screen words it; `terminal` = retrying is pointless.
	 */
	error = $state<{ message: string | null; terminal: boolean } | null>(null);
	results = $state.raw<KioskCheckOutMemberResult[]>([]);
	secondsLeft = $state(SELF_CHECKOUT_RETURN_SECONDS);

	constructor(
		private readonly init: {
			gate: Extract<GateInput, { source: 'smart-card' | 'thaid' }>;
			primaryEvacueeId: string;
			members: readonly KioskEvacueeSummary[];
		},
		private readonly deps: SelfCheckoutDeps
	) {}

	get busy(): boolean {
		return this.step === 'submitting';
	}

	get canContinue(): boolean {
		return this.selectedIds.length > 0;
	}

	get expired(): boolean {
		return this.secondsLeft <= 0;
	}

	start(): void {
		if (this.step !== 'ask') return;
		this.selectedIds = initialCheckoutSelection(this.init.members);
		this.step = 'members';
	}

	toggleMember(evacueeId: string): void {
		if (this.step !== 'members') return;
		const target = this.init.members.find((member) => member.evacuee_id === evacueeId);
		if (!target || !isSelfCheckoutEligible(target.status)) return;
		this.selectedIds = this.selectedIds.includes(evacueeId)
			? this.selectedIds.filter((id) => id !== evacueeId)
			: [...this.selectedIds, evacueeId];
	}

	next(): void {
		if (this.step === 'members' && this.canContinue) this.step = 'destination';
	}

	chooseDestination(destination: KioskCheckoutDestination): void {
		if (this.step !== 'destination') return;
		this.destination = destination;
		this.step = 'confirm';
	}

	back(): void {
		this.error = null;
		if (this.step === 'confirm') this.step = 'destination';
		else if (this.step === 'destination') this.step = 'members';
		else if (this.step === 'members') this.step = 'ask';
	}

	async confirm(): Promise<void> {
		if (this.step !== 'confirm' || !this.destination || !this.canContinue) return;
		this.step = 'submitting';
		this.error = null;
		try {
			const response = await this.deps.checkOut({
				primary_evacuee_id: this.init.primaryEvacueeId,
				evacuee_ids: [...this.selectedIds],
				destination_type: this.destination,
				gate: this.init.gate
			});
			this.results = response.members;
			this.secondsLeft = SELF_CHECKOUT_RETURN_SECONDS;
			this.step = 'done';
		} catch (error) {
			this.error =
				error instanceof KioskRequestError
					? {
							message: error.message,
							terminal: error.code !== null && TERMINAL_ERROR_CODES.has(error.code)
						}
					: { message: null, terminal: false };
			this.step = 'confirm';
		}
	}

	/** One second of the return countdown on the done screen. */
	tick(): void {
		if (this.step === 'done' && this.secondsLeft > 0) this.secondsLeft -= 1;
	}
}
