import type { InternalBannersResult } from '../data/internal-banners.api';
import type { KioskBannerSlide } from '../domain/kiosk-banner-feed';
import { KIOSK_BANNER_REFRESH_MS } from './kiosk-banner-attract.svelte.js';

export type InternalDisplayStatus = 'loading' | 'playing' | 'empty' | 'invalid_code';

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
	private readonly fetchBanners: () => Promise<InternalBannersResult>;

	constructor(opts: { fetch: () => Promise<InternalBannersResult>; refreshMs?: number }) {
		this.fetchBanners = opts.fetch;
		this.refreshMs = opts.refreshMs ?? KIOSK_BANNER_REFRESH_MS;
	}

	start(): void {
		this.active = true;
		this.refreshTimer ??= setInterval(() => void this.refresh(), this.refreshMs);
		void this.refresh();
	}

	destroy(): void {
		this.active = false;
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
			this.stopTimers();
			this.pending = null;
			this.slides = [];
			this.index = 0;
			this.status = 'invalid_code';
			return;
		}
		if (result.kind !== 'ok') return;
		if (result.slides.length > 0 && this.slides.length > 1) {
			// A rotation timer is running; wait for its next boundary instead of cutting a slide short.
			this.pending = result.slides;
			return;
		}
		this.apply(result.slides);
	}

	private apply(list: KioskBannerSlide[]): void {
		this.slides = list;
		this.index = 0;
		this.pending = null;
		this.status = list.length === 0 ? 'empty' : 'playing';
		this.scheduleRotation();
	}

	private stopTimers(): void {
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
