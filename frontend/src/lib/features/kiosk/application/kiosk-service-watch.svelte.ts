export const KIOSK_SERVICE_POLL_MS = 30_000;

interface Deps {
	/** `true`/`false` = the server's answer, `null` = the read failed. Must bypass the config cache, or
	 * a change would only be noticed after the TTL. */
	readServiceOpen: () => Promise<boolean | null>;
	/** Which server answer triggers `onChange`: `'open'` (watching a closed kiosk) or `'closed'`. */
	until: 'open' | 'closed';
	onChange: () => void;
	intervalMs?: number;
}

/**
 * Asks the server every 30 s whether the kiosk's service state changed, so staff never have to
 * touch the device: on the closed page it waits for a reopening (`until: 'open'`), on the home
 * screen it waits for a closing (`until: 'closed'`). Polls one request at a time (the next wait
 * starts after the previous answer) and stops itself after calling `onChange` once.
 *
 * Only a server answer triggers a change: a read that fails (non-ok / network / timeout, `null` or
 * a throw) changes nothing and is retried at the next tick.
 */
export class KioskServiceWatch {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running = false;

	constructor(private readonly deps: Deps) {}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.schedule();
	}

	stop(): void {
		this.running = false;
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
	}

	private schedule(): void {
		this.timer = setTimeout(() => void this.poll(), this.deps.intervalMs ?? KIOSK_SERVICE_POLL_MS);
	}

	private async poll(): Promise<void> {
		this.timer = null;
		let serviceOpen: boolean | null = null;
		try {
			serviceOpen = await this.deps.readServiceOpen();
		} catch {
			// Keep waiting: a failed read must never flip the kiosk by itself.
		}
		if (!this.running) return;
		if (serviceOpen === (this.deps.until === 'open')) {
			this.stop();
			this.deps.onChange();
			return;
		}
		this.schedule();
	}
}
