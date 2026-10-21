import { describe, expect, it } from 'vitest';
import { kioskLabelDots } from './print-label';
import { volunteerLabelIdentity, volunteerLabelLayout } from './volunteer-label';

describe('volunteerLabelIdentity', () => {
	it('reads the volunteer badge as จิตอาสา · code and keeps the given display name', () => {
		expect(
			volunteerLabelIdentity({ display_name: 'สมชาย ใจ****ดี', volunteer_code: 'V-012' })
		).toEqual({
			name: 'สมชาย ใจ****ดี',
			badge: 'จิตอาสา · V-012'
		});
	});
});

describe('volunteerLabelLayout', () => {
	it('keeps the QR flush right and vertically centred inside the 80x60 mm canvas', () => {
		// Canvas 639x479 dots; padding 2 mm = 16 dots.
		expect(kioskLabelDots()).toEqual({ width: 639, height: 479 });

		// 264 px QR: right edge 359 + 264 = 623 = 639 - 16; (479 - 264) / 2 = 107.5 rounds to 108.
		expect(volunteerLabelLayout(264).qr).toEqual({ x: 359, y: 108 });
		// Largest QR box (34.75 mm = 277 whole dots): 346 + 277 = 623; (479 - 277) / 2 = 101.
		expect(volunteerLabelLayout(277).qr).toEqual({ x: 346, y: 101 });
	});

	it('puts the divider between the text column and the QR with a 2 mm gap on each side', () => {
		// 264 px QR at x 359: divider x = 359 - 16 (gap) - 2 (0.25 mm) = 341, spanning the padded height
		// 479 - 2 * 16 = 447. Text column starts at padding 16 and ends one gap before the divider:
		// 341 - 16 - 16 = 309; its top is padding + 2 mm top offset = 16 + 16 = 32.
		const small = volunteerLabelLayout(264);
		expect(small.divider).toEqual({ x: 341, y: 16, width: 2, height: 447 });
		expect(small.text).toMatchObject({ x: 16, y: 32, width: 309 });

		// 277 px QR at x 346: divider x = 346 - 16 - 2 = 328; text width = 328 - 16 - 16 = 296.
		const large = volunteerLabelLayout(277);
		expect(large.divider.x).toBe(328);
		expect(large.text.width).toBe(296);
	});

	it('places the link bottom-left under the text column with the text ending above it', () => {
		// Bottom padding edge = 479 - 16 = 463. The 7 pt link is 19.74 dots tall, line box 1.3x =
		// 25.66 dots, so the line spans 437.34..463: its middle is 450.17 -> 450, and the text column
		// must stop at the line's top, floored to 437.
		for (const qrPx of [264, 277]) {
			const { link, text } = volunteerLabelLayout(qrPx);
			expect(link).toEqual({ x: 16, y: 450 });
			expect(text.bottom).toBe(437);
			expect(text.bottom).toBeLessThan(link.y);
		}
	});
});
