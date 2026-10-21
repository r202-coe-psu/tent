import { KioskRequestError } from '../data/kiosk-check-in.api';
import { isKioskPhoneSubmittable } from '../domain/phone';
import type { KioskVolunteerCardResult } from '../data/kiosk-volunteer-card.api';
import type { KioskPrintFlowResult } from './kiosk-print-flow';

export type VolunteerCardStep = 'phone' | 'confirm' | 'printing' | 'done' | 'print_failed';

export interface VolunteerCardSessionDeps {
	lookup(phone: string): Promise<KioskVolunteerCardResult>;
	print(volunteer: KioskVolunteerCardResult['volunteer']): Promise<KioskPrintFlowResult>;
}

const NOT_FOUND_MESSAGE = 'ไม่พบข้อมูลจิตอาสาที่ใช้เบอร์นี้ในศูนย์นี้ กรุณาติดต่อเจ้าหน้าที่';
const RATE_LIMITED_MESSAGE = 'ลองผิดหลายครั้ง กรุณารอสักครู่หรือติดต่อเจ้าหน้าที่';
const METHOD_DISABLED_MESSAGE = 'ช่องทางนี้ปิดใช้งาน กรุณาติดต่อเจ้าหน้าที่';
const PRINT_RENDER_FAILED_MESSAGE = 'สร้าง QR Code สำหรับพิมพ์ไม่สำเร็จ';
const GENERIC_MESSAGE = 'ระบบไม่สามารถทำรายการได้ กรุณาลองอีกครั้ง';

function messageFor(error: unknown): string {
	if (!(error instanceof KioskRequestError)) return GENERIC_MESSAGE;
	switch (error.code) {
		case 'KIOSK_VOLUNTEER_CARD_NOT_FOUND':
			return NOT_FOUND_MESSAGE;
		case 'KIOSK_RATE_LIMITED':
			return RATE_LIMITED_MESSAGE;
		case 'KIOSK_METHOD_DISABLED':
			return METHOD_DISABLED_MESSAGE;
		default:
			return error.message || GENERIC_MESSAGE;
	}
}

export class VolunteerCardSession {
	step = $state<VolunteerCardStep>('phone');
	/** What is shown to the visitor when the last action failed. */
	error = $state('');
	volunteer = $state.raw<KioskVolunteerCardResult['volunteer'] | null>(null);
	/** A request is in flight: keys and buttons wait. */
	busy = $state(false);

	private phoneValue = $state('');
	/** Bumped by `reset()` so an answer for an abandoned visit is dropped. */
	private generation = 0;

	constructor(private readonly deps: VolunteerCardSessionDeps) {}

	get phone(): string {
		return this.phoneValue;
	}

	set phone(value: string) {
		this.phoneValue = value;
		if (value) this.error = '';
	}

	get canSubmitPhone(): boolean {
		return !this.busy && isKioskPhoneSubmittable(this.phoneValue);
	}

	async submitPhone(): Promise<void> {
		if (!this.canSubmitPhone) return;
		const generation = this.generation;
		this.busy = true;
		this.error = '';
		try {
			const found = await this.deps.lookup(this.phoneValue);
			if (generation !== this.generation) return;
			this.volunteer = found.volunteer;
			this.step = 'confirm';
		} catch (error) {
			if (generation !== this.generation) return;
			this.error = messageFor(error);
		} finally {
			if (generation === this.generation) this.busy = false;
		}
	}

	async confirmPrint(): Promise<void> {
		if (this.step !== 'confirm') return;
		await this.printVolunteer();
	}

	/** Print the same volunteer again after a printer failure; no new lookup. */
	async retryPrint(): Promise<void> {
		if (this.step !== 'print_failed') return;
		await this.printVolunteer();
	}

	back(): void {
		if (this.step !== 'confirm') return;
		this.error = '';
		this.volunteer = null;
		this.step = 'phone';
	}

	/** Forget the visit: the typed digits, the volunteer and any error. */
	reset(): void {
		this.generation += 1;
		this.phoneValue = '';
		this.volunteer = null;
		this.error = '';
		this.busy = false;
		this.step = 'phone';
	}

	private async printVolunteer(): Promise<void> {
		if (!this.volunteer || this.busy) return;
		const generation = this.generation;
		this.busy = true;
		this.error = '';
		this.step = 'printing';
		try {
			let outcome: KioskPrintFlowResult;
			try {
				outcome = await this.deps.print(this.volunteer);
			} catch {
				outcome = { kind: 'error', message: PRINT_RENDER_FAILED_MESSAGE };
			}
			if (generation !== this.generation) return;
			if (outcome.kind === 'error') {
				this.error = outcome.message;
				this.step = 'print_failed';
				return;
			}
			this.step = 'done';
		} finally {
			if (generation === this.generation) this.busy = false;
		}
	}
}
