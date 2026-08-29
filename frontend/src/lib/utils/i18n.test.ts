import { describe, it, expect } from 'vitest';
import { getTranslation, formatNumber, formatDate } from './i18n';

describe('i18n utilities', () => {
	describe('getTranslation', () => {
		const sampleI18n = {
			th: { title: 'หน้าแรก', count: 'จำนวน' },
			en: { title: 'Home', count: 'Count' }
		};

		it('returns Thai translation when language is "th"', () => {
			const result = getTranslation(sampleI18n, 'th');
			expect(result).toEqual(sampleI18n.th);
			expect(result.title).toBe('หน้าแรก');
		});

		it('returns English translation when language is "en"', () => {
			const result = getTranslation(sampleI18n, 'en');
			expect(result).toEqual(sampleI18n.en);
			expect(result.title).toBe('Home');
		});

		it('falls back to Thai translation when language is undefined', () => {
			const result = getTranslation(sampleI18n, undefined);
			expect(result).toEqual(sampleI18n.th);
		});

		it('falls back to Thai translation when language is unsupported/unknown', () => {
			const result = getTranslation(sampleI18n, 'ja');
			expect(result).toEqual(sampleI18n.th);
		});

		it('falls back to Thai translation when language is an empty string', () => {
			const result = getTranslation(sampleI18n, '');
			expect(result).toEqual(sampleI18n.th);
		});
	});

	describe('formatNumber', () => {
		it('returns "0" for null or undefined inputs', () => {
			expect(formatNumber(null)).toBe('0');
			expect(formatNumber(undefined)).toBe('0');
			expect(formatNumber(null, 'en')).toBe('0');
			expect(formatNumber(undefined, 'en')).toBe('0');
		});

		it('formats zero correctly', () => {
			expect(formatNumber(0)).toBe('0');
			expect(formatNumber(0, 'en')).toBe('0');
		});

		it('formats positive integers with appropriate digit grouping', () => {
			expect(formatNumber(1234567, 'th')).toBe('1,234,567');
			expect(formatNumber(1234567, 'en')).toBe('1,234,567');
		});

		it('formats negative numbers correctly', () => {
			expect(formatNumber(-42, 'th')).toBe('-42');
			expect(formatNumber(-42, 'en')).toBe('-42');
		});

		it('formats floating point numbers correctly', () => {
			const formatted = formatNumber(1234.56, 'en');
			expect(formatted).toBe('1,234.56');
		});

		it('defaults to Thai locale if lang is omitted', () => {
			expect(formatNumber(1000)).toBe('1,000');
		});
	});

	describe('formatDate', () => {
		const fixedTimestamp = 1751620800000; // 2025-07-04T09:20:00.000Z
		const fixedIso = '2025-07-04T09:20:00.000Z';
		const fixedDate = new Date(fixedIso);

		it('returns empty string for null, undefined, or empty string inputs', () => {
			expect(formatDate(null)).toBe('');
			expect(formatDate(undefined)).toBe('');
			expect(formatDate('')).toBe('');
		});

		it('formats ISO string correctly for Thai locale', () => {
			const formatted = formatDate(fixedIso, 'th');
			expect(formatted).toBeDefined();
			expect(typeof formatted).toBe('string');
			// Thai year for 2025 is 2568, and month is ก.ค.
			expect(formatted).toMatch(/ก\.ค\.|2568/);
		});

		it('formats ISO string correctly for English locale', () => {
			const formatted = formatDate(fixedIso, 'en');
			expect(formatted).toBeDefined();
			expect(typeof formatted).toBe('string');
			expect(formatted).toMatch(/Jul|2025/);
		});

		it('formats Date instance correctly', () => {
			const formattedEn = formatDate(fixedDate, 'en');
			expect(formattedEn).toMatch(/Jul|2025/);

			const formattedTh = formatDate(fixedDate, 'th');
			expect(formattedTh).toMatch(/ก\.ค\.|2568/);
		});

		it('formats numeric timestamp correctly', () => {
			const formatted = formatDate(fixedTimestamp, 'en');
			expect(formatted).toMatch(/Jul|2025/);
		});

		it('respects custom Intl.DateTimeFormatOptions', () => {
			const formatted = formatDate(fixedIso, 'en', {
				year: 'numeric',
				month: 'long',
				day: '2-digit'
			});
			expect(formatted).toMatch(/July/);
		});
	});
});
