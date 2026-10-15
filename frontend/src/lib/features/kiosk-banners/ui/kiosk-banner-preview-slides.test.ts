import { describe, expect, it } from 'vitest';
import { buildFormPreviewSlide, buildListPreviewSlides } from './kiosk-banner-preview-slides';

const now = new Date('2026-10-15T05:00:00.000Z');

const banner = (id: string, over: Record<string, unknown> = {}) => ({
	_id: id,
	_rev: `1-${id}`,
	title: `T ${id}`,
	caption: null as string | null,
	order: 1,
	duration_sec: 10,
	start_at: '2026-10-15T01:00:00.000Z',
	end_at: '2026-10-15T11:00:00.000Z',
	status: 'active' as const,
	...over
});

const imageUrl = (id: string, rev?: string) => `/img/${id}?v=${rev}`;

describe('buildListPreviewSlides', () => {
	it('keeps only banners active now, in real playback order', () => {
		const slides = buildListPreviewSlides(
			[
				banner('kiosk_banner:b', { order: 2 }),
				banner('kiosk_banner:off', { status: 'inactive' }),
				banner('kiosk_banner:future', { start_at: '2026-10-16T01:00:00.000Z' }),
				banner('kiosk_banner:a', { order: 1 })
			],
			now,
			imageUrl
		);
		expect(slides.map((s) => s.id)).toEqual(['kiosk_banner:a', 'kiosk_banner:b']);
	});

	it('maps the slide shape the kiosk overlay expects', () => {
		const [slide] = buildListPreviewSlides(
			[banner('kiosk_banner:a', { caption: 'cap', duration_sec: 5 })],
			now,
			imageUrl
		);
		expect(slide).toEqual({
			id: 'kiosk_banner:a',
			title: 'T kiosk_banner:a',
			caption: 'cap',
			duration_sec: 5,
			image_url: '/img/kiosk_banner:a?v=1-kiosk_banner:a'
		});
	});

	it('is empty when nothing is active', () => {
		expect(buildListPreviewSlides([], now, imageUrl)).toEqual([]);
	});
});

describe('buildFormPreviewSlide', () => {
	const values = { title: ' ป้าย ', caption: '', duration_sec: 8 };

	it('returns null without any image', () => {
		expect(buildFormPreviewSlide(values, null)).toBeNull();
	});

	it('uses the given image url, a null caption and the form duration', () => {
		expect(buildFormPreviewSlide(values, 'blob:x')).toEqual({
			id: 'preview',
			title: 'ป้าย',
			caption: null,
			duration_sec: 8,
			image_url: 'blob:x'
		});
	});

	it('falls back to the default duration when the field is not a valid 3-60 number', () => {
		expect(
			buildFormPreviewSlide({ ...values, duration_sec: Number.NaN }, 'blob:x')?.duration_sec
		).toBe(10);
		expect(buildFormPreviewSlide({ ...values, duration_sec: 1 }, 'blob:x')?.duration_sec).toBe(10);
	});

	it('shows a placeholder title when the title is still empty', () => {
		expect(buildFormPreviewSlide({ ...values, title: '' }, 'blob:x')?.title).toBe(
			'ตัวอย่างแบนเนอร์'
		);
	});
});
