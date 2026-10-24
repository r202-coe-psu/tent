import type { KioskDeviceInfoResult } from '../data/kiosk-device-info.api';
import type { KioskStaffPinResult } from '../data/kiosk-staff-pin.api';
import type { KioskDeviceInfo, KioskHostInfo } from '../domain/device-info';

/** Nobody touched the panel for this long: close it, so the info is not left on an open kiosk. */
export const DEVICE_INFO_IDLE_MS = 60_000;

export type DeviceInfoPhase = 'idle' | 'pin' | 'shown';

export type DeviceInfoDeps = {
	/** Asks the server to check the PIN and, if it is right, tell this kiosk's info. Never throws. */
	fetchDeviceInfo: (pin: string) => Promise<KioskDeviceInfoResult>;
	/** Asks the kiosk machine for its hostname and LAN IPs. Never throws. */
	fetchHostInfo: () => Promise<KioskHostInfo>;
};

/**
 * Staff «device info» from the kiosk home page: ask for the staff PIN, then show this kiosk's info.
 * The server checks the PIN and returns the info in the same call, so `verify` is handed to the PIN
 * panel as its check and the answer is kept here until the panel reports the PIN verified.
 */
export class DeviceInfoSession {
	phase = $state<DeviceInfoPhase>('idle');
	info = $state.raw<KioskDeviceInfo | null>(null);
	host = $state.raw<KioskHostInfo | null>(null);

	#idleTimer: ReturnType<typeof setTimeout> | null = null;
	#pending: { info: KioskDeviceInfo; host: KioskHostInfo } | null = null;

	constructor(private readonly deps: DeviceInfoDeps) {}

	get pinOpen(): boolean {
		return this.phase === 'pin';
	}

	get shown(): boolean {
		return this.phase === 'shown';
	}

	/** The small info button: ask for the PIN. */
	open(): void {
		this.phase = 'pin';
	}

	/** The PIN panel's check: the server answer, with the info held back until `pinVerified`. */
	async verify(pin: string): Promise<KioskStaffPinResult> {
		const [result, host] = await Promise.all([
			this.deps.fetchDeviceInfo(pin),
			this.deps.fetchHostInfo()
		]);
		if (result.kind !== 'ok') return result;
		this.#pending = { info: result.info, host };
		return { kind: 'verified' };
	}

	/** The PIN panel said the PIN was right: show what the server told. */
	pinVerified(): void {
		if (this.phase !== 'pin' || !this.#pending) return;
		this.info = this.#pending.info;
		this.host = this.#pending.host;
		this.#pending = null;
		this.phase = 'shown';
		this.touch();
	}

	pinCancelled(): void {
		if (this.phase === 'pin') this.phase = 'idle';
	}

	/** Close the panel and forget what it showed. */
	close(): void {
		this.#clearIdleTimer();
		this.info = null;
		this.host = null;
		this.#pending = null;
		this.phase = 'idle';
	}

	/** Any tap in the panel: the idle clock starts again. */
	touch(): void {
		if (this.phase !== 'shown') return;
		this.#clearIdleTimer();
		this.#idleTimer = setTimeout(() => this.close(), DEVICE_INFO_IDLE_MS);
	}

	destroy(): void {
		this.#clearIdleTimer();
	}

	#clearIdleTimer(): void {
		if (this.#idleTimer) clearTimeout(this.#idleTimer);
		this.#idleTimer = null;
	}
}
