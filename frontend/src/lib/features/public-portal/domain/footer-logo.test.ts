import { describe, it, expect } from 'vitest';
import {
	FOOTER_LOGO_IMAGE_MAX_BYTES,
	FOOTER_LOGO_MAX,
	appendFooterLogo,
	canAddFooterLogo,
	footerLogoImageUrl,
	footerLogoInputSchema,
	moveFooterLogo,
	parseFooterLogos,
	publishedFooterLogos,
	removeFooterLogo,
	replaceFooterLogo,
	validateFooterLogoFile,
	type FooterLogo
} from './footer-logo';

const logo = (id: string, order: number, is_published = true): FooterLogo => ({
	id,
	order,
	is_published,
	alt_th: `โลโก้ ${id}`,
	alt_en: '',
	link_url: ''
});

describe('footerLogoInputSchema', () => {
	it('trims and defaults optional fields', () => {
		const parsed = footerLogoInputSchema.parse({ alt_th: '  มอ.  ' });
		expect(parsed).toEqual({ alt_th: 'มอ.', alt_en: '', link_url: '', is_published: true });
	});

	it('requires alt_th and caps it at 120 characters', () => {
		expect(footerLogoInputSchema.safeParse({ alt_th: '   ' }).success).toBe(false);
		expect(footerLogoInputSchema.safeParse({ alt_th: 'ก'.repeat(121) }).success).toBe(false);
		expect(footerLogoInputSchema.safeParse({ alt_th: 'ก'.repeat(120) }).success).toBe(true);
	});

	it('accepts only https links or empty', () => {
		const withLink = (link_url: string) =>
			footerLogoInputSchema.safeParse({ alt_th: 'วช', link_url }).success;
		expect(withLink('https://www.nrct.go.th')).toBe(true);
		expect(withLink('')).toBe(true);
		expect(withLink('http://www.nrct.go.th')).toBe(false);
		expect(withLink('javascript:alert(1)')).toBe(false);
	});
});

describe('parseFooterLogos', () => {
	it('drops entries that fail the schema and non-arrays', () => {
		expect(parseFooterLogos(undefined)).toEqual([]);
		expect(parseFooterLogos([logo('a', 1), { id: 'b' }])).toEqual([logo('a', 1)]);
	});
});

describe('publishedFooterLogos', () => {
	it('keeps published entries sorted by order then id', () => {
		const result = publishedFooterLogos([logo('c', 2), logo('b', 1, false), logo('a', 2)]);
		expect(result.map((l) => l.id)).toEqual(['a', 'c']);
	});
});

describe('appendFooterLogo', () => {
	it('appends after the last order and renumbers gaps', () => {
		const result = appendFooterLogo([logo('a', 3), logo('b', 7)], 'c', {
			alt_th: 'ใหม่',
			alt_en: '',
			link_url: '',
			is_published: true
		});
		expect(result.map((l) => [l.id, l.order])).toEqual([
			['a', 1],
			['b', 2],
			['c', 3]
		]);
	});

	it(`allows at most ${FOOTER_LOGO_MAX} logos`, () => {
		const full = Array.from({ length: FOOTER_LOGO_MAX }, (_, i) => logo(`l${i}`, i + 1));
		expect(canAddFooterLogo(full.slice(1))).toBe(true);
		expect(canAddFooterLogo(full)).toBe(false);
	});
});

describe('replaceFooterLogo', () => {
	it('keeps id and order, returns null for an unknown id', () => {
		const input = { alt_th: 'แก้', alt_en: 'Edited', link_url: '', is_published: false };
		expect(replaceFooterLogo([logo('a', 1)], 'a', input)).toEqual([
			{ ...input, id: 'a', order: 1 }
		]);
		expect(replaceFooterLogo([logo('a', 1)], 'x', input)).toBeNull();
	});
});

describe('removeFooterLogo', () => {
	it('removes and renumbers 1..n', () => {
		const result = removeFooterLogo([logo('a', 1), logo('b', 2), logo('c', 3)], 'b');
		expect(result?.map((l) => [l.id, l.order])).toEqual([
			['a', 1],
			['c', 2]
		]);
		expect(removeFooterLogo([logo('a', 1)], 'x')).toBeNull();
	});
});

describe('moveFooterLogo', () => {
	const list = [logo('a', 1), logo('b', 2), logo('c', 3)];

	it('swaps with the neighbour', () => {
		expect(moveFooterLogo(list, 'b', 'up')?.map((l) => l.id)).toEqual(['b', 'a', 'c']);
		expect(moveFooterLogo(list, 'b', 'down')?.map((l) => l.id)).toEqual(['a', 'c', 'b']);
	});

	it('leaves the order unchanged at either end', () => {
		expect(moveFooterLogo(list, 'a', 'up')?.map((l) => l.id)).toEqual(['a', 'b', 'c']);
		expect(moveFooterLogo(list, 'c', 'down')?.map((l) => l.id)).toEqual(['a', 'b', 'c']);
	});

	it('returns null for an unknown id', () => {
		expect(moveFooterLogo(list, 'x', 'up')).toBeNull();
	});
});

describe('footerLogoImageUrl', () => {
	it('adds the digest as a cache-busting query', () => {
		expect(footerLogoImageUrl('01J', 'md5-abc=')).toBe(
			'/api/public/v1/config/footer-logos/01J/image?v=md5-abc%3D'
		);
		expect(footerLogoImageUrl('01J')).toBe('/api/public/v1/config/footer-logos/01J/image');
	});
});

describe('validateFooterLogoFile', () => {
	it('accepts png / jpeg / webp up to 512 KB', () => {
		expect(FOOTER_LOGO_IMAGE_MAX_BYTES).toBe(512 * 1024);
		for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
			expect(validateFooterLogoFile({ type, size: 512 * 1024 })).toBeNull();
		}
	});

	it('rejects files over 512 KB, empty files and other types', () => {
		expect(validateFooterLogoFile({ type: 'image/png', size: 512 * 1024 + 1 })).toBe(
			'รูปภาพต้องมีขนาดไม่เกิน 512 KB'
		);
		expect(validateFooterLogoFile({ type: 'image/png', size: 0 })).toBe('ไม่พบข้อมูลรูปภาพ');
		expect(validateFooterLogoFile({ type: 'image/svg+xml', size: 10 })).toBe(
			'รองรับเฉพาะรูป png / jpeg / webp'
		);
	});
});
