import type { StaffPinVerifyResult } from './staff-pin';

/** How long a wrong PIN is held before the kiosk hears back. */
export const STAFF_PIN_WRONG_DELAY_MS = 1000;
/** Warn on every this-many wrong PINs in a row from one device. */
export const STAFF_PIN_ALERT_EVERY = 5;

export type StaffPinThrottleDeps = {
	sleep?: (ms: number) => Promise<void>;
	warn?: (line: string) => void;
};

/**
 * Slows down guessing a device's staff PIN without ever locking the device: one check at a time
 * per device, each wrong PIN held for {@link STAFF_PIN_WRONG_DELAY_MS} before the next may start,
 * and a warning on every {@link STAFF_PIN_ALERT_EVERY} wrong PINs in a row. The count lives in this
 * process only and starts again after a right PIN or a restart; it never blocks a check.
 */
export class StaffPinThrottle {
	/** Tail of each device's queue; removed once the device has nothing waiting. */
	private readonly queues = new Map<string, Promise<void>>();
	private readonly wrongInARow = new Map<string, number>();
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly warn: (line: string) => void;

	constructor(deps: StaffPinThrottleDeps = {}) {
		this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
		this.warn = deps.warn ?? ((line) => console.warn(line));
	}

	/** Run `check` for `deviceId` once the device's earlier checks (and their delays) are done. */
	async run(
		deviceId: string,
		check: () => Promise<StaffPinVerifyResult>
	): Promise<StaffPinVerifyResult> {
		const previous = this.queues.get(deviceId) ?? Promise.resolve();
		let release!: () => void;
		const turn = new Promise<void>((resolve) => (release = resolve));
		const tail = previous.then(() => turn);
		this.queues.set(deviceId, tail);

		await previous;
		try {
			const result = await check();
			if (result.kind === 'wrong') {
				this.recordWrong(deviceId);
				// Still holding the device's turn, so a queued guess waits out this delay too.
				await this.sleep(STAFF_PIN_WRONG_DELAY_MS);
			} else if (result.kind === 'ok') {
				this.wrongInARow.delete(deviceId);
			}
			return result;
		} finally {
			release();
			if (this.queues.get(deviceId) === tail) this.queues.delete(deviceId);
		}
	}

	private recordWrong(deviceId: string): void {
		const count = (this.wrongInARow.get(deviceId) ?? 0) + 1;
		this.wrongInARow.set(deviceId, count);
		if (count % STAFF_PIN_ALERT_EVERY === 0) {
			this.warn(
				`[scanner-staff-pin] repeated wrong PINs device=${deviceId} consecutive=${count} at=${new Date().toISOString()}`
			);
		}
	}
}

export const staffPinThrottle = new StaffPinThrottle();
