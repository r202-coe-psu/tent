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

		it('formats ISO string as th-TH Buddhist calendar regardless of language arg', () => {
			const th = formatDate(fixedIso, 'th');
			const en = formatDate(fixedIso, 'en');
			expect(th).toMatch(/ก\.ค\./);
			expect(th).toMatch(/2568/);
			expect(en).toBe(th);
		});

		it('formats Date instance as th-TH', () => {
			const formatted = formatDate(fixedDate, 'en');
			expect(formatted).toMatch(/ก\.ค\./);
			expect(formatted).toMatch(/2568/);
		});

		it('formats numeric timestamp as th-TH', () => {
			const formatted = formatDate(fixedTimestamp, 'en');
			expect(formatted).toMatch(/ก\.ค\./);
			expect(formatted).toMatch(/2568/);
		});

		it('respects custom layout options but stays th-TH', () => {
			const formatted = formatDate(fixedIso, 'en', {
				year: 'numeric',
				month: 'long',
				day: '2-digit'
			});
			expect(formatted).toMatch(/กรกฎาคม/);
			expect(formatted).toMatch(/2568/);
		});

		it('uses Bangkok wall clock when date crosses UTC midnight', () => {
			// 2025-07-04T20:00Z → 05 ก.ค. 2568 in Bangkok
			const formatted = formatDate('2025-07-04T20:00:00.000Z');
			expect(formatted).toMatch(/05/);
			expect(formatted).toMatch(/ก\.ค\./);
			expect(formatted).toMatch(/2568/);
		});
	});
});
