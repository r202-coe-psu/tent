import type { KioskConfig } from '../data/kiosk-config.api';

export const KIOSK_CLOSED_POLL_MS = 30_000;

interface Deps {
	/** Must bypass the config cache, or a closed kiosk would only notice a reopening after the TTL. */
	fetchConfig: (options: { bypassCache: true }) => Promise<KioskConfig>;
	onReopen: () => void;
	intervalMs?: number;
}

/**
 * While the closed page is up, asks the server every 30 s whether the kiosk was reopened, so staff
 * never have to touch the device. Polls one request at a time (the next wait starts after the
 * previous answer) and stops itself after calling `onReopen` once.
 *
 * An unreadable config is read as "open" by `fetchKioskConfig` (a failed read must not close a
 * working kiosk), so a network blip also reopens the kiosk; if it is still closed, the next work
 * request is refused with 403 KIOSK_CLOSED and the layout sends it back here. The server is the
 * authority, so this is accepted rather than tracked with an extra "read failed" flag.
 */
export class KioskClosedWatch {
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
		this.timer = setTimeout(() => void this.poll(), this.deps.intervalMs ?? KIOSK_CLOSED_POLL_MS);
	}

	private async poll(): Promise<void> {
		this.timer = null;
		let serviceOpen = false;
		try {
			serviceOpen = (await this.deps.fetchConfig({ bypassCache: true })).serviceOpen;
		} catch {
			// Keep waiting: a failed read must never reopen the kiosk by itself.
		}
		if (!this.running) return;
		if (serviceOpen) {
			this.stop();
			this.deps.onReopen();
			return;
		}
		this.schedule();
	}
}
