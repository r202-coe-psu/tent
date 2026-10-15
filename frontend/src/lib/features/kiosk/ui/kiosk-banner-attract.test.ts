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

	it('renders the caption as literal text, never as markup', () => {
		const body = preview([slide('a', { caption: '<b>x</b>' })]);

		expect(body).toContain('&lt;b>x&lt;/b>');
		expect(body).not.toContain('<b>x</b>');
	});

	it('draws one dot per slide, highlighting the current one', () => {
		const body = preview([slide('a'), slide('b'), slide('c')]);

		expect(body.match(/data-testid="kiosk-banner-dot"/g)).toHaveLength(3);
		expect(body.match(/data-current="true"/g)).toHaveLength(1);
	});

	it('draws no dots for a single slide', () => {
		expect(preview([slide('a')])).not.toContain('kiosk-banner-dot');
	});

	it('always tells people to touch the screen', () => {
		expect(preview([slide('a')])).toContain('แตะหน้าจอเพื่อเริ่มใช้งาน');
	});

	it('stays below the system banner and leaves its height free', () => {
		const body = preview([slide('a')]);

		expect(body).toContain('bottom-[var(--testing-banner-height)]');
		expect(body).toContain('z-40');
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
