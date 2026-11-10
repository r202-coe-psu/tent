import type { InternalBannersResult } from '../data/internal-banners.api';
import type { KioskBannerSlide } from '../domain/kiosk-banner-feed';
import { KIOSK_BANNER_REFRESH_MS } from './kiosk-banner-attract.svelte.js';

/** Retry delays after a first-load error: 10s, 20s, 40s, then 60s for every later try. */
const CONNECT_RETRY_MS = [10_000, 20_000, 40_000, 60_000] as const;

export type InternalDisplayStatus = 'loading' | 'connecting' | 'playing' | 'empty' | 'invalid_code';

export class InternalBannerDisplayController {
	status = $state<InternalDisplayStatus>('loading');
	slides = $state.raw<KioskBannerSlide[]>([]);
	index = $state(0);
	readonly current = $derived(this.slides[this.index] ?? null);

	private rotationTimer: ReturnType<typeof setTimeout> | null = null;
	private refreshTimer: ReturnType<typeof setInterval> | null = null;
	private readonly refreshMs: number;
	private pending: KioskBannerSlide[] | null = null;
	private active = false;
	/** True once the feed has answered ok or not_found; until then errors retry with backoff. */
	private settled = false;
	private failures = 0;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly fetchBanners: () => Promise<InternalBannersResult>;
	private readonly onInvalid: (() => void) | undefined;

	constructor(opts: {
		fetch: () => Promise<InternalBannersResult>;
		refreshMs?: number;
		/** Called once when the feed rejects the code (not_found), never after destroy(). */
		onInvalid?: () => void;
	}) {
		this.fetchBanners = opts.fetch;
		this.onInvalid = opts.onInvalid;
		this.refreshMs = opts.refreshMs ?? KIOSK_BANNER_REFRESH_MS;
	}

	start(): void {
		this.active = true;
		this.refreshTimer ??= setInterval(() => {
			// While still connecting, the backoff timer owns the retries.
			if (this.settled) void this.refresh();
		}, this.refreshMs);
		void this.refresh();
	}

	destroy(): void {
		this.active = false;
		this.settled = false;
		this.failures = 0;
		this.stopTimers();
		this.pending = null;
		this.slides = [];
		this.index = 0;
		this.status = 'loading';
	}

	private async refresh(): Promise<void> {
		const result = await this.fetchBanners();
		if (!this.active) return;
		if (result.kind === 'not_found') {
			this.settled = true;
			this.stopTimers();
			this.pending = null;
			this.slides = [];
			this.index = 0;
			this.status = 'invalid_code';
			this.onInvalid?.();
			return;
		}
		if (result.kind !== 'ok') {
			if (!this.settled) this.scheduleRetry();
			return;
		}
		this.settled = true;
		if (result.slides.length > 0 && this.slides.length > 1) {
			// A rotation timer is running; wait for its next boundary instead of cutting a slide short.
			this.pending = result.slides;
			return;
		}
		this.apply(result.slides);
	}

	private scheduleRetry(): void {
		this.status = 'connecting';
		const delay = CONNECT_RETRY_MS[Math.min(this.failures, CONNECT_RETRY_MS.length - 1)];
		this.failures += 1;
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			void this.refresh();
		}, delay);
	}

	private apply(list: KioskBannerSlide[]): void {
		this.slides = list;
		this.index = 0;
		this.pending = null;
		this.status = list.length === 0 ? 'empty' : 'playing';
		this.scheduleRotation();
	}

	private stopTimers(): void {
		if (this.retryTimer !== null) clearTimeout(this.retryTimer);
		this.retryTimer = null;
		if (this.rotationTimer !== null) clearTimeout(this.rotationTimer);
		this.rotationTimer = null;
		if (this.refreshTimer !== null) clearInterval(this.refreshTimer);
		this.refreshTimer = null;
	}

	private scheduleRotation(): void {
		if (this.rotationTimer !== null) clearTimeout(this.rotationTimer);
		this.rotationTimer = null;
		const slide = this.current;
		if (!slide || this.slides.length <= 1) return;
		this.rotationTimer = setTimeout(() => this.advance(), slide.duration_sec * 1000);
	}

	private advance(): void {
		this.rotationTimer = null;
		if (this.pending) {
			const list = this.pending;
			this.pending = null;
			this.apply(list);
			return;
		}
		this.index = (this.index + 1) % this.slides.length;
		this.scheduleRotation();
	}
}
