import {
	KioskRequestError,
	type GateInput,
	type KioskEvacueeSummary,
	type KioskHouseholdCandidate,
	type KioskLookupResponse,
	type KioskReprintInput,
	type KioskReprintMember,
	type KioskReprintResult
} from '../data/kiosk-check-in.api';
import type { KioskStaffPinResult } from '../data/kiosk-staff-pin.api';
import { isKioskPhoneSubmittable } from '../domain/phone';
import { REPRINT_NOBODY_REASON, REPRINT_PRE_REGISTERED_REASON } from '../domain/check-in-status';
import { selectableIds, isAllSelected, toggleAllSelection } from '../domain/household-selection';
import type { KioskPrintFlowResult } from './kiosk-print-flow';

export const REPRINT_LAST4_LENGTH = 4;
export const REPRINT_PHONE_MAX_LENGTH = 10;

export type ReprintStep =
	| 'phone'
	| 'candidates'
	| 'members'
	| 'verify'
	| 'staff_pin'
	| 'printing'
	| 'print_failed'
	| 'done';

/** The server calls and the printer, injected so the step logic never touches `fetch` or the DOM. */
export interface ReprintSessionDeps {
	lookup(input: GateInput): Promise<KioskLookupResponse>;
	reprint(input: KioskReprintInput): Promise<KioskReprintResult>;
	print(members: readonly KioskReprintMember[]): Promise<KioskPrintFlowResult>;
}

const NOT_FOUND_MESSAGE = 'ไม่พบข้อมูลที่ลงทะเบียนด้วยเบอร์นี้';
const RATE_LIMITED_MESSAGE = 'ลองผิดหลายครั้ง กรุณารอสักครู่หรือติดต่อเจ้าหน้าที่';
const UNVERIFIABLE_MESSAGE = 'ไม่สามารถยืนยันตัวตนได้ กรุณาติดต่อเจ้าหน้าที่';
const VERIFY_FAILED_MESSAGE = 'เลข 4 ตัวท้ายไม่ถูกต้อง';
const GENERIC_MESSAGE = 'ระบบไม่สามารถทำรายการได้ กรุณาลองอีกครั้ง';
const PRINT_RENDER_FAILED_MESSAGE = 'สร้าง QR Code สำหรับพิมพ์ไม่สำเร็จ';

function messageFor(error: unknown): string {
	if (!(error instanceof KioskRequestError)) return GENERIC_MESSAGE;
	switch (error.code) {
		case 'PRE_REGISTRATION_NOT_FOUND':
		case 'KIOSK_REPRINT_NOT_FOUND':
			return NOT_FOUND_MESSAGE;
		case 'KIOSK_RATE_LIMITED':
			return RATE_LIMITED_MESSAGE;
		case 'KIOSK_REPRINT_UNVERIFIABLE':
			return UNVERIFIABLE_MESSAGE;
		case 'KIOSK_REPRINT_VERIFY_FAILED':
			return VERIFY_FAILED_MESSAGE;
		case 'KIOSK_TOO_MANY_MATCHES':
			return 'พบหลายรายการ กรุณาติดต่อเจ้าหน้าที่';
		case 'KIOSK_METHOD_DISABLED':
			return 'ช่องทางนี้ปิดใช้งาน กรุณาติดต่อเจ้าหน้าที่';
		default:
			return error.message || GENERIC_MESSAGE;
	}
}

/**
 * One QR reprint: phone → (household, when the phone is shared) → members → last four digits of the
 * phone owner's citizen id → print. Everything the visitor typed or the server returned for the
 * labels lives here only until `reset()`; nothing is stored or put in a URL.
 *
 * The kiosk never prints on its own judgement: it asks `reprint`, which checks the last four digits
 * server-side (and counts failures), and prints exactly the labels that come back.
 */
export class ReprintSession {
	step = $state<ReprintStep>('phone');
	/** What is shown to the visitor when the last action failed; cleared when they type again. */
	error = $state('');
	/** A request is in flight: keys and buttons wait. */
	busy = $state(false);
	candidates = $state.raw<KioskHouseholdCandidate[]>([]);
	members = $state.raw<KioskEvacueeSummary[]>([]);
	selectedIds = $state<string[]>([]);
	/** Verified labels of the household, kept so a printer failure can retry without re-asking. */
	printable = $state.raw<KioskReprintMember[]>([]);
	printedCount = $state(0);

	private phoneValue = $state('');
	private last4Value = $state('');
	private primaryEvacueeId = '';
	private fromCandidates = false;
	/** Bumped by `reset()` so an answer for an abandoned visit is dropped. */
	private generation = 0;

	constructor(private readonly deps: ReprintSessionDeps) {}

	get phone(): string {
		return this.phoneValue;
	}

	set phone(value: string) {
		this.phoneValue = value;
		if (value) this.error = '';
	}

	get idLast4(): string {
		return this.last4Value;
	}

	set idLast4(value: string) {
		this.last4Value = value;
		if (value) this.error = '';
	}

	get canSubmitPhone(): boolean {
		return !this.busy && isKioskPhoneSubmittable(this.phoneValue);
	}

	get canVerify(): boolean {
		return !this.busy && this.last4Value.length === REPRINT_LAST4_LENGTH;
	}

	get canContinue(): boolean {
		return this.selectedIds.length > 0;
	}

	/** Nobody in this household has been registered at the kiosk yet: nothing to print. */
	get blocked(): boolean {
		return this.step === 'members' && selectableIds(this.members).length === 0;
	}

	/** Banner text for a blocked household: pre-registered wording only if everyone is. */
	get blockedReason(): string {
		const everyonePreRegistered =
			this.members.length > 0 && this.members.every((m) => m.status === 'pre_registered');
		return everyonePreRegistered ? REPRINT_PRE_REGISTERED_REASON : REPRINT_NOBODY_REASON;
	}

	get allSelected(): boolean {
		return isAllSelected(this.selectedIds, this.members);
	}

	async submitPhone(): Promise<void> {
		if (!this.canSubmitPhone) return;
		await this.runLookup({ source: 'phone', phone: this.phoneValue }, false);
	}

	async chooseCandidate(primaryEvacueeId: string): Promise<void> {
		if (this.busy || this.step !== 'candidates') return;
		await this.runLookup(
			{ source: 'phone', phone: this.phoneValue, primary_evacuee_id: primaryEvacueeId },
			true
		);
	}

	toggleMember(evacueeId: string): void {
		if (this.busy || !this.members.some((m) => m.evacuee_id === evacueeId && m.selectable)) return;
		this.selectedIds = this.selectedIds.includes(evacueeId)
			? this.selectedIds.filter((id) => id !== evacueeId)
			: [...this.selectedIds, evacueeId];
	}

	toggleAll(): void {
		if (this.busy) return;
		this.selectedIds = toggleAllSelection(this.selectedIds, this.members);
	}

	continueToVerify(): void {
		if (this.step !== 'members' || !this.canContinue) return;
		this.last4Value = '';
		this.error = '';
		this.step = 'verify';
	}

	async submitVerify(): Promise<void> {
		if (this.step !== 'verify' || !this.canVerify) return;
		const generation = this.generation;
		const input: KioskReprintInput = {
			phone: this.phoneValue,
			primary_evacuee_id: this.primaryEvacueeId,
			id_last4: this.last4Value,
			evacuee_ids: [...this.selectedIds]
		};
		this.busy = true;
		this.error = '';
		try {
			const result = await this.deps.reprint(input);
			if (generation !== this.generation) return;
			this.last4Value = '';
			this.printable = result.members;
			await this.printLabels(generation);
		} catch (error) {
			if (generation !== this.generation) return;
			this.last4Value = '';
			this.error = messageFor(error);
			if (error instanceof KioskRequestError && error.code === 'KIOSK_REPRINT_NOT_FOUND') {
				this.clearHousehold();
				this.step = 'phone';
			}
		} finally {
			if (generation === this.generation) this.busy = false;
		}
	}

	/** Staff chooses the kiosk PIN instead of the last four digits. */
	openStaffPin(): void {
		if (this.step !== 'verify' || this.busy) return;
		this.last4Value = '';
		this.error = '';
		this.step = 'staff_pin';
	}

	/** The PIN panel was cancelled (or went idle): back to the last four digits. */
	cancelStaffPin(): void {
		if (this.step !== 'staff_pin') return;
		this.step = 'verify';
	}

	/**
	 * Asks the server to reprint with the staff PIN. The PIN is only passed through, never kept.
	 * Prints nothing: the PIN panel reports `verified` first and then calls `onStaffPinVerified`.
	 */
	async verifyStaffPin(pin: string): Promise<KioskStaffPinResult> {
		const generation = this.generation;
		try {
			const result = await this.deps.reprint({
				phone: this.phoneValue,
				primary_evacuee_id: this.primaryEvacueeId,
				staff_pin: pin,
				evacuee_ids: [...this.selectedIds]
			});
			if (generation !== this.generation) return { kind: 'error' };
			this.printable = result.members;
			return { kind: 'verified' };
		} catch (error) {
			if (generation !== this.generation) return { kind: 'error' };
			if (error instanceof KioskRequestError && error.code === 'KIOSK_REPRINT_STAFF_PIN_INVALID') {
				return { kind: 'wrong' };
			}
			if (error instanceof KioskRequestError && error.code === 'staff_pin_not_set') {
				return { kind: 'not_set' };
			}
			if (error instanceof KioskRequestError && error.code === 'KIOSK_REPRINT_NOT_FOUND') {
				this.error = messageFor(error);
				this.clearHousehold();
				this.step = 'phone';
				return { kind: 'error' };
			}
			return { kind: 'error' };
		}
	}

	/** The PIN panel accepted the PIN: print the labels the server returned. */
	async onStaffPinVerified(): Promise<void> {
		if (this.step !== 'staff_pin' || this.printable.length === 0) return;
		const generation = this.generation;
		this.busy = true;
		try {
			await this.printLabels(generation);
		} finally {
			if (generation === this.generation) this.busy = false;
		}
	}

	/** Print the already-verified labels again after a printer failure; no new verification. */
	async retryPrint(): Promise<void> {
		if (this.step !== 'print_failed' || this.busy || this.printable.length === 0) return;
		const generation = this.generation;
		this.busy = true;
		try {
			await this.printLabels(generation);
		} finally {
			if (generation === this.generation) this.busy = false;
		}
	}

	back(): void {
		if (this.busy) return;
		this.error = '';
		switch (this.step) {
			case 'verify':
				this.last4Value = '';
				this.step = 'members';
				break;
			case 'staff_pin':
				this.step = 'verify';
				break;
			case 'members':
				this.clearHousehold(true);
				this.step = this.fromCandidates ? 'candidates' : 'phone';
				break;
			case 'candidates':
				this.candidates = [];
				this.step = 'phone';
				break;
			default:
				break;
		}
	}

	/** Forget the visit: the typed digits, the household and any verified labels. */
	reset(): void {
		this.generation += 1;
		this.phoneValue = '';
		this.last4Value = '';
		this.error = '';
		this.busy = false;
		this.candidates = [];
		this.clearHousehold();
		this.printable = [];
		this.printedCount = 0;
		this.fromCandidates = false;
		this.step = 'phone';
	}

	private async runLookup(gate: GateInput, fromCandidates: boolean): Promise<void> {
		const generation = this.generation;
		this.busy = true;
		this.error = '';
		try {
			const found = await this.deps.lookup(gate);
			if (generation !== this.generation) return;
			if (found.kind === 'candidates') {
				this.candidates = found.candidates;
				this.step = 'candidates';
				return;
			}
			if (found.kind === 'kiosk_registered') {
				this.error = NOT_FOUND_MESSAGE;
				this.step = 'phone';
				return;
			}
			this.fromCandidates = fromCandidates;
			this.primaryEvacueeId = found.primary_evacuee_id;
			this.members = found.members;
			// Nobody is ticked up front: the visitor picks whose QR to print.
			this.selectedIds = [];
			this.step = 'members';
		} catch (error) {
			if (generation !== this.generation) return;
			this.error = messageFor(error);
		} finally {
			if (generation === this.generation) this.busy = false;
		}
	}

	private async printLabels(generation: number): Promise<void> {
		this.step = 'printing';
		let outcome: KioskPrintFlowResult;
		try {
			outcome = await this.deps.print(this.printable);
		} catch {
			outcome = { kind: 'error', message: PRINT_RENDER_FAILED_MESSAGE };
		}
		if (generation !== this.generation) return;
		if (outcome.kind === 'error') {
			this.error = outcome.message;
			this.step = 'print_failed';
			return;
		}
		this.printedCount = this.printable.length;
		this.printable = [];
		this.step = 'done';
	}

	private clearHousehold(keepCandidates = false): void {
		this.members = [];
		this.selectedIds = [];
		this.primaryEvacueeId = '';
		if (!keepCandidates) this.candidates = [];
	}
}
