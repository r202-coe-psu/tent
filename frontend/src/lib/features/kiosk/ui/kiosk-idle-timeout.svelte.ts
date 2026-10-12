export const KIOSK_IDLE_TIMEOUT_MS = 60_000;

export class KioskIdleTimeout {
	paused = $state(false);

	private timer: ReturnType<typeof setTimeout> | null = null;
	private started = false;

	constructor(
		private readonly timeoutMs: number,
		private readonly onIdle: () => void
	) {}

	start(): void {
		this.started = true;
		this.schedule();
	}

	recordActivity(): void {
		if (!this.started || this.paused) return;
		this.schedule();
	}

	setPaused(paused: boolean): void {
		if (this.paused === paused) return;
		this.paused = paused;
		if (paused) {
			this.clearTimer();
		} else {
			this.schedule();
		}
	}

	stop(): void {
		this.started = false;
		this.clearTimer();
	}

	private schedule(): void {
		this.clearTimer();
		if (!this.started || this.paused) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			if (!this.started || this.paused) return;
			this.started = false;
			this.onIdle();
		}, this.timeoutMs);
	}

	private clearTimer(): void {
		if (this.timer === null) return;
		clearTimeout(this.timer);
		this.timer = null;
	}
}
