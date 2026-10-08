import type { KioskStaffPinResult } from '../data/kiosk-staff-pin.api';

/** Digits in a staff PIN. */
export const STAFF_PIN_LENGTH = 6;
/** Nobody touched the panel for this long: close it as if cancelled, so the kiosk is not stuck. */
export const STAFF_PIN_IDLE_MS = 30_000;

export type StaffPinStatus =
	| { kind: 'idle' }
	| { kind: 'checking' }
	| { kind: 'wrong' }
	/** The server could not check it (timeout, server down): staff may try again. */
	| { kind: 'error' }
	/** No PIN set on this kiosk: nothing staff can type will help. */
	| { kind: 'blocked' };

export type StaffPinEntryDeps = {
	/** Checks the PIN with the server. A throw counts as `error`. */
	verify: (pin: string) => Promise<KioskStaffPinResult>;
	/** The PIN was right: carry on (the PIN has already been forgotten). */
	onverified: () => void;
	/** Cancel, Esc or 30 s without a touch. */
	oncancel: () => void;
	/** The keys are usable again after a wrong PIN or a failed check (the panel refocuses them). */
	onretry?: () => void;
};

/**
 * The staff PIN panel's state: what has been typed, the server check, and the idle close.
 * The PIN is never put in a URL, a log or storage, and is cleared on every way out.
 */
export class StaffPinEntry {
	pin = $state('');
	status = $state<StaffPinStatus>({ kind: 'idle' });

	#closed = false;
	#idleTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly deps: StaffPinEntryDeps) {}

	get keysDisabled(): boolean {
		return this.status.kind === 'checking' || this.status.kind === 'blocked';
	}

	get canConfirm(): boolean {
		return this.pin.length === STAFF_PIN_LENGTH && !this.keysDisabled;
	}

	/** Starts the idle clock; call when the panel opens. */
	start(): void {
		this.touch();
	}

	/** Any touch or key press: the idle clock starts again. */
	touch(): void {
		if (this.#closed) return;
		if (this.#idleTimer) clearTimeout(this.#idleTimer);
		this.#idleTimer = setTimeout(() => this.cancel(), STAFF_PIN_IDLE_MS);
	}

	/** Forget the PIN and stop the clock, without telling anyone (the page closed the panel). */
	close(): void {
		this.#closed = true;
		this.pin = '';
		if (this.#idleTimer) clearTimeout(this.#idleTimer);
		this.#idleTimer = null;
	}

	cancel(): void {
		if (this.#closed) return;
		this.close();
		this.deps.oncancel();
	}

	/**
	 * A key from a hardware keyboard: a digit, Backspace, Enter (confirm) or Escape (cancel).
	 * Returns true when the key was used.
	 */
	press(key: string): boolean {
		if (key === 'Escape') {
			this.cancel();
			return true;
		}
		if (/^\d$/.test(key)) {
			if (!this.keysDisabled && this.pin.length < STAFF_PIN_LENGTH) this.pin += key;
			return true;
		}
		if (key === 'Backspace') {
			if (!this.keysDisabled) this.pin = this.pin.slice(0, -1);
			return true;
		}
		if (key === 'Enter') {
			void this.confirm();
			return true;
		}
		return false;
	}

	async confirm(): Promise<void> {
		if (!this.canConfirm) return;
		const entered = this.pin;
		this.status = { kind: 'checking' };
		const result = await this.deps
			.verify(entered)
			.catch((): KioskStaffPinResult => ({ kind: 'error' }));
		if (this.#closed) return; // cancelled, timed out or closed by the page meanwhile
		this.pin = '';
		switch (result.kind) {
			case 'verified':
				this.close();
				this.deps.onverified();
				return;
			case 'wrong':
			case 'error':
				this.status = { kind: result.kind };
				this.deps.onretry?.();
				return;
			case 'not_set':
				this.status = { kind: 'blocked' };
		}
	}
}
