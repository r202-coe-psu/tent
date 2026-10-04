import { describe, expect, it } from 'vitest';
import {
	advanceCardReadPercent,
	CARD_READ_STAGES,
	cardReadPercent,
	cardReadStatusText,
	parseCardReadProgress
} from './card-read-progress';

describe('parseCardReadProgress', () => {
	it('accepts the report scanner_client sends', () => {
		expect(parseCardReadProgress({ phase: 'photo', done: 3, total: 20 })).toEqual({
			phase: 'photo',
			done: 3,
			total: 20
		});
	});

	it('keeps done within total', () => {
		expect(parseCardReadProgress({ phase: 'data', done: 12, total: 9 })?.done).toBe(9);
	});

	it.each([
		['nothing', undefined],
		['null', null],
		['a string', 'photo'],
		['an unknown phase', { phase: 'saving', done: 1, total: 2 }],
		['a missing phase', { done: 1, total: 2 }],
		['text numbers', { phase: 'data', done: '1', total: '9' }],
		['a zero total', { phase: 'data', done: 0, total: 0 }],
		['a negative done', { phase: 'photo', done: -1, total: 20 }],
		['a fractional done', { phase: 'photo', done: 1.5, total: 20 }]
	])('rejects %s', (_name, detail) => {
		expect(parseCardReadProgress(detail)).toBeNull();
	});
});

describe('cardReadPercent', () => {
	it('gives the text fields a small share up front', () => {
		expect(cardReadPercent({ phase: 'data', done: 0, total: 9 })).toBe(0);
		expect(cardReadPercent({ phase: 'data', done: 9, total: 9 })).toBe(15);
	});

	it('spreads the rest over the photo chunks, ending at 100', () => {
		expect(cardReadPercent({ phase: 'photo', done: 0, total: 20 })).toBe(15);
		expect(cardReadPercent({ phase: 'photo', done: 10, total: 20 })).toBe(58);
		expect(cardReadPercent({ phase: 'photo', done: 20, total: 20 })).toBe(100);
	});

	it('never leaves 0–100', () => {
		for (let done = 0; done <= 20; done++) {
			const percent = cardReadPercent({ phase: 'photo', done, total: 20 });
			expect(percent).toBeGreaterThanOrEqual(0);
			expect(percent).toBeLessThanOrEqual(100);
		}
	});
});

describe('advanceCardReadPercent', () => {
	it('moves forward', () => {
		expect(advanceCardReadPercent(20, { phase: 'photo', done: 10, total: 20 })).toBe(58);
	});

	it('never goes backwards when the reader starts the photo over', () => {
		expect(advanceCardReadPercent(58, { phase: 'photo', done: 1, total: 20 })).toBe(58);
	});
});

describe('cardReadStatusText', () => {
	it('names every stage in Thai, in the order the screen lists them', () => {
		expect(CARD_READ_STAGES).toEqual(['data', 'photo', 'saving']);
		expect(CARD_READ_STAGES.map(cardReadStatusText)).toEqual([
			'กำลังอ่านข้อมูลบัตร',
			'กำลังอ่านรูปถ่าย',
			'กำลังบันทึกข้อมูล'
		]);
	});
});
