import { describe, expect, it } from 'vitest';
import {
	BANNER_COLOR_PRESETS,
	bannerColorSchema,
	contrastRatio,
	emptyKioskBannerTemplate,
	isHardToRead,
	kioskBannerTemplateAlignSchema,
	kioskBannerTemplateSchema
} from './kiosk-banner-template';

const validTemplate = {
	heading: 'ประกาศ',
	body: 'บรรทัดแรก\nบรรทัดสอง',
	align: 'center',
	bg_color: '#112233',
	text_color: '#ffffff',
	image: null
};

describe('bannerColorSchema', () => {
	it('accepts #RRGGBB and normalises to lowercase', () => {
		expect(bannerColorSchema.parse('#A1B2C3')).toBe('#a1b2c3');
		expect(bannerColorSchema.parse('#a1b2c3')).toBe('#a1b2c3');
	});

	it('rejects short hex, names, rgb() and url()', () => {
		for (const bad of ['#fff', 'red', 'rgb(0,0,0)', 'url(http://x)', '#12345g', '112233', '']) {
			expect(bannerColorSchema.safeParse(bad).success).toBe(false);
		}
	});
});

describe('kioskBannerTemplateAlignSchema', () => {
	it('accepts left, center and right only', () => {
		for (const ok of ['left', 'center', 'right']) {
			expect(kioskBannerTemplateAlignSchema.safeParse(ok).success).toBe(true);
		}
		expect(kioskBannerTemplateAlignSchema.safeParse('justify').success).toBe(false);
	});
});

describe('kioskBannerTemplateSchema', () => {
	it('accepts a valid template and keeps multi-line body', () => {
		const parsed = kioskBannerTemplateSchema.parse(validTemplate);
		expect(parsed).toEqual(validTemplate);
	});

	it('trims heading and body and lowercases colors', () => {
		const parsed = kioskBannerTemplateSchema.parse({
			...validTemplate,
			heading: '  หัวข้อ  ',
			body: '\n เนื้อหา \n',
			bg_color: '#AABBCC'
		});
		expect(parsed).toMatchObject({ heading: 'หัวข้อ', body: 'เนื้อหา', bg_color: '#aabbcc' });
	});

	it('accepts the own-attachment image reference', () => {
		expect(
			kioskBannerTemplateSchema.safeParse({ ...validTemplate, image: 'template_image' }).success
		).toBe(true);
	});

	it('rejects an image URL or any other image value', () => {
		for (const image of ['https://evil/x.png', 'other', undefined]) {
			expect(kioskBannerTemplateSchema.safeParse({ ...validTemplate, image }).success).toBe(false);
		}
	});

	it('rejects unknown keys such as html or image_url', () => {
		expect(
			kioskBannerTemplateSchema.safeParse({ ...validTemplate, html: '<b>x</b>' }).success
		).toBe(false);
		expect(
			kioskBannerTemplateSchema.safeParse({ ...validTemplate, image_url: 'https://x/y.png' })
				.success
		).toBe(false);
	});

	it('rejects a heading over 120 and a body over 600 with Thai messages', () => {
		const heading = kioskBannerTemplateSchema.safeParse({
			...validTemplate,
			heading: 'ก'.repeat(121)
		});
		expect(!heading.success && heading.error.issues[0].message).toBe(
			'หัวข้อประกาศยาวเกิน 120 ตัวอักษร'
		);
		const body = kioskBannerTemplateSchema.safeParse({ ...validTemplate, body: 'ก'.repeat(601) });
		expect(!body.success && body.error.issues[0].message).toBe('เนื้อหาประกาศยาวเกิน 600 ตัวอักษร');
		expect(
			kioskBannerTemplateSchema.safeParse({
				...validTemplate,
				heading: 'ก'.repeat(120),
				body: 'ก'.repeat(600)
			}).success
		).toBe(true);
	});

	it('requires a heading or a body, reporting on the heading', () => {
		const both = kioskBannerTemplateSchema.safeParse({ ...validTemplate, heading: ' ', body: '' });
		expect(!both.success && both.error.issues[0]).toMatchObject({
			path: ['heading'],
			message: 'ระบุหัวข้อหรือเนื้อหาประกาศ'
		});
		expect(
			kioskBannerTemplateSchema.safeParse({ ...validTemplate, heading: '', body: 'x' }).success
		).toBe(true);
		expect(
			kioskBannerTemplateSchema.safeParse({ ...validTemplate, heading: 'x', body: '' }).success
		).toBe(true);
	});
});

describe('contrastRatio', () => {
	it('is 21 for black on white and 1 for identical colours', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(contrastRatio('#1e3a8a', '#1e3a8a')).toBeCloseTo(1, 5);
	});

	it('is symmetric', () => {
		expect(contrastRatio('#1e3a8a', '#facc15')).toBeCloseTo(
			contrastRatio('#facc15', '#1e3a8a'),
			10
		);
	});

	it('matches the known WCAG ratio for #777777 on white (about 4.48)', () => {
		expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
	});
});

describe('isHardToRead', () => {
	it('flags a pair below WCAG AA 4.5:1', () => {
		expect(isHardToRead('#ffffff', '#777777')).toBe(true);
	});

	it('does not flag white text on navy', () => {
		expect(isHardToRead('#1e3a8a', '#ffffff')).toBe(false);
	});
});

describe('BANNER_COLOR_PRESETS', () => {
	it('offers the core Thai-labelled swatches', () => {
		expect(BANNER_COLOR_PRESETS).toEqual(
			expect.arrayContaining([
				{ value: '#ffffff', label: 'ขาว' },
				{ value: '#000000', label: 'ดำ' },
				{ value: '#1e3a8a', label: 'น้ำเงิน' },
				{ value: '#b91c1c', label: 'แดง' },
				{ value: '#facc15', label: 'เหลือง' },
				{ value: '#15803d', label: 'เขียว' }
			])
		);
	});

	it('has unique values that all pass bannerColorSchema unchanged', () => {
		const values = BANNER_COLOR_PRESETS.map((p) => p.value);
		expect(new Set(values).size).toBe(values.length);
		for (const value of values) {
			expect(bannerColorSchema.parse(value)).toBe(value);
		}
	});
});

describe('emptyKioskBannerTemplate', () => {
	it('starts blank, centred, white on navy, without an image', () => {
		expect(emptyKioskBannerTemplate()).toEqual({
			heading: '',
			body: '',
			align: 'center',
			bg_color: '#1e3a8a',
			text_color: '#ffffff',
			image: null
		});
	});

	it('uses a colour pair that is not hard to read', () => {
		const t = emptyKioskBannerTemplate();
		expect(isHardToRead(t.bg_color, t.text_color)).toBe(false);
	});

	it('returns a fresh object each call', () => {
		expect(emptyKioskBannerTemplate()).not.toBe(emptyKioskBannerTemplate());
	});
});
