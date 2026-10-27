import type { KioskBannerSlide } from '../domain/kiosk-banner-feed';
import { KioskIdleTimeout } from './kiosk-idle-timeout.svelte.js';

export const KIOSK_BANNER_IDLE_MS = 30_000;
export const KIOSK_BANNER_REFRESH_MS = 5 * 60_000;

export type AttractPhase = 'hidden' | 'armed' | 'showing';

/**
 * Attract-overlay state machine (design guideline §3): hidden -> armed (banners exist) -> showing
 * (idle for KIOSK_BANNER_IDLE_MS) -> armed (dismissed). All timers live here, not in `$effect`.
 */
export class KioskBannerAttractController {
	phase = $state<AttractPhase>('hidden');
	slides = $state.raw<KioskBannerSlide[]>([]);
	index = $state(0);
	readonly current = $derived(this.slides[this.index] ?? null);

	private readonly fetchBanners: () => Promise<KioskBannerSlide[]>;
	private readonly refreshMs: number;
	private readonly idle: KioskIdleTimeout;
	private rotationTimer: ReturnType<typeof setTimeout> | null = null;
	private refreshTimer: ReturnType<typeof setInterval> | null = null;
	private pending: KioskBannerSlide[] | null = null;
	private active = false;

	constructor(opts: {
		fetch: () => Promise<KioskBannerSlide[]>;
		idleMs?: number;
		refreshMs?: number;
	}) {
		this.fetchBanners = opts.fetch;
		this.refreshMs = opts.refreshMs ?? KIOSK_BANNER_REFRESH_MS;
		this.idle = new KioskIdleTimeout(opts.idleMs ?? KIOSK_BANNER_IDLE_MS, () => this.show());
	}

	start(): void {
		this.active = true;
		if (this.refreshTimer === null) {
			this.refreshTimer = setInterval(() => void this.refresh(), this.refreshMs);
		}
		void this.refresh();
	}

	recordActivity(): void {
		if (this.phase === 'armed') this.idle.recordActivity();
	}

	dismiss(): void {
		if (this.phase !== 'showing') return;
		this.clearRotation();
		this.phase = 'armed';
		const next = this.pending;
		this.pending = null;
		if (next) {
			this.applyWhileNotShowing(next);
			if (this.phase === 'armed') this.idle.start();
		} else {
			this.idle.start();
		}
	}

	markBroken(id: string): void {
		const position = this.slides.findIndex((s) => s.id === id);
		if (this.pending) this.pending = this.pending.filter((s) => s.id !== id);
		if (position === -1) return;
		const wasCurrent = position === this.index;
		this.slides = this.slides.filter((s) => s.id !== id);
		if (this.slides.length === 0) {
			this.hide();
			return;
		}
		if (position < this.index) this.index -= 1;
		else if (wasCurrent) this.index %= this.slides.length;
		if (this.phase === 'showing' && wasCurrent) this.scheduleRotation();
	}

	destroy(): void {
		this.active = false;
		this.clearRotation();
		if (this.refreshTimer !== null) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.idle.stop();
		this.pending = null;
		this.slides = [];
		this.index = 0;
		this.phase = 'hidden';
	}

	private async refresh(): Promise<void> {
		const list = await this.fetchBanners();
		if (!this.active) return;
		this.applyList(list);
	}

	private applyList(list: KioskBannerSlide[]): void {
		if (this.phase !== 'showing') {
			this.applyWhileNotShowing(list);
			return;
		}
		if (list.length === 0) {
			this.hide();
		} else if (this.slides.length <= 1) {
			// No rotation timer is running, so there is no "next slide change" to wait for.
			const currentId = this.current?.id;
			this.slides = list;
			const kept = list.findIndex((s) => s.id === currentId);
			this.index = kept === -1 ? 0 : kept;
			this.scheduleRotation();
		} else {
			this.pending = list;
		}
	}

	private applyWhileNotShowing(list: KioskBannerSlide[]): void {
		this.slides = list;
		this.index = 0;
		if (list.length === 0) {
			this.hide();
		} else if (this.phase === 'hidden') {
			this.phase = 'armed';
			this.idle.start();
		}
	}

	private hide(): void {
		this.clearRotation();
		this.idle.stop();
		this.pending = null;
		this.slides = [];
		this.index = 0;
		this.phase = 'hidden';
	}

	private show(): void {
		if (this.phase !== 'armed' || this.slides.length === 0) return;
		this.phase = 'showing';
		this.index = 0;
		this.scheduleRotation();
	}

	private scheduleRotation(): void {
		this.clearRotation();
		const slide = this.current;
		if (this.phase !== 'showing' || !slide || this.slides.length <= 1) return;
		this.rotationTimer = setTimeout(() => this.advance(), slide.duration_sec * 1000);
	}

	private advance(): void {
		this.rotationTimer = null;
		if (this.phase !== 'showing') return;
		const currentId = this.current?.id;
		if (this.pending) {
			const list = this.pending;
			this.pending = null;
			this.slides = list;
			const kept = list.findIndex((s) => s.id === currentId);
			this.index = kept === -1 ? 0 : (kept + 1) % list.length;
		} else {
			this.index = (this.index + 1) % this.slides.length;
		}
		this.scheduleRotation();
	}

	private clearRotation(): void {
		if (this.rotationTimer === null) return;
		clearTimeout(this.rotationTimer);
		this.rotationTimer = null;
	}
}
