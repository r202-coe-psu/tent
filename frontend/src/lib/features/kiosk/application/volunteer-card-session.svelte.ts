import type { LanguageCode } from '$lib/stores/language.svelte';
import { KioskRequestError } from '../data/kiosk-check-in.api';
import { isKioskClosedError } from '../data/kiosk-closed';
import { isKioskPhoneSubmittable } from '../domain/phone';
import type { KioskVolunteerCardResult } from '../data/kiosk-volunteer-card.api';
import type { KioskPrintFlowResult } from './kiosk-print-flow';

export type VolunteerCardStep = 'phone' | 'confirm' | 'printing' | 'done' | 'print_failed';

export interface VolunteerCardSessionDeps {
	lookup(phone: string): Promise<KioskVolunteerCardResult>;
	print(volunteer: KioskVolunteerCardResult['volunteer']): Promise<KioskPrintFlowResult>;
	/** The server refused the lookup because the kiosk is closed: the page shows the closed screen. */
	onClosed?: () => void;
}

const MESSAGES: Record<
	LanguageCode,
	Record<'notFound' | 'rateLimited' | 'methodDisabled' | 'printRenderFailed' | 'generic', string>
> = {
	th: {
		notFound: 'ไม่พบข้อมูลจิตอาสาที่ใช้เบอร์นี้ในศูนย์นี้ กรุณาติดต่อเจ้าหน้าที่',
		rateLimited: 'ลองผิดหลายครั้ง กรุณารอสักครู่หรือติดต่อเจ้าหน้าที่',
		methodDisabled: 'ช่องทางนี้ปิดใช้งาน กรุณาติดต่อเจ้าหน้าที่',
		printRenderFailed: 'สร้าง QR Code สำหรับพิมพ์ไม่สำเร็จ',
		generic: 'ระบบไม่สามารถทำรายการได้ กรุณาลองอีกครั้ง'
	},
	en: {
		notFound: 'No volunteer with this number at this shelter. Please see staff',
		rateLimited: 'Too many wrong tries. Please wait a moment or see staff',
		methodDisabled: 'This option is turned off. Please see staff',
		printRenderFailed: 'Could not create the QR code to print',
		generic: 'Something went wrong. Please try again'
	}
};

function messageFor(error: unknown, language: LanguageCode): string {
	const messages = MESSAGES[language];
	if (!(error instanceof KioskRequestError)) return messages.generic;
	switch (error.code) {
		case 'KIOSK_VOLUNTEER_CARD_NOT_FOUND':
			return messages.notFound;
		case 'KIOSK_RATE_LIMITED':
			return messages.rateLimited;
		case 'KIOSK_METHOD_DISABLED':
			return messages.methodDisabled;
		default:
			return error.message || messages.generic;
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

	/**
	 * `language` is read each time a message is worded, so it follows the visitor's choice; it
	 * defaults to Thai. The UI passes the kiosk's current language in.
	 */
	constructor(
		private readonly deps: VolunteerCardSessionDeps,
		private readonly language: () => LanguageCode = () => 'th'
	) {}

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
			if (isKioskClosedError(error)) {
				// A closed kiosk ends the visit; it is not a switched-off method.
				this.reset();
				this.deps.onClosed?.();
				return;
			}
			this.error = messageFor(error, this.language());
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
				outcome = { kind: 'error', message: MESSAGES[this.language()].printRenderFailed };
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
