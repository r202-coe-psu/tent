import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import type { KioskBannerSlide } from '../domain/kiosk-banner-feed';
import { fetchKioskBanners } from '../data/kiosk-banners.api';
import KioskBannerAttract from './kiosk-banner-attract.svelte';

vi.mock('../data/kiosk-banners.api', () => ({ fetchKioskBanners: vi.fn().mockResolvedValue([]) }));

const slide = (id: string, over: Partial<KioskBannerSlide> = {}): KioskBannerSlide => ({
	id,
	title: `Title ${id}`,
	caption: null,
	duration_sec: 10,
	image_url: `/img/${id}`,
	...over
});

const preview = (banners: KioskBannerSlide[]) =>
	render(KioskBannerAttract, { props: { mode: 'preview', banners } }).body;

describe('KioskBannerAttract preview markup', () => {
	it('renders the first slide image with its title as alt text', () => {
		const body = preview([slide('a'), slide('b')]);

		expect(body).toMatch(/<img[^>]*src="\/img\/a"/);
		expect(body).toMatch(/<img[^>]*alt="Title a"/);
		expect(body).not.toContain('/img/b');
	});

	it('shows only the image: no caption, dots, caption bar or touch prompt', () => {
		const body = preview([slide('a', { caption: 'Lunch at noon' }), slide('b')]);

		expect(body).not.toContain('Lunch at noon');
		expect(body).not.toContain('kiosk-banner-dot');
		expect(body).not.toContain('kiosk-banner-caption-bar');
		expect(body).not.toContain('แตะหน้าจอเพื่อเริ่มใช้งาน');
	});

	it('renders nothing when there are no slides', () => {
		expect(preview([])).not.toContain('kiosk-banner-attract');
	});
});

describe('KioskBannerAttract live', () => {
	it('renders nothing before banners are known, and fetches nothing during render', () => {
		const { body } = render(KioskBannerAttract, { props: { mode: 'live' } });

		expect(body).not.toContain('kiosk-banner-attract');
		expect(fetchKioskBanners).not.toHaveBeenCalled();
	});
});
