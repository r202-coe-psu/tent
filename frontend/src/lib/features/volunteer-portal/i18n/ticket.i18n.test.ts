import { describe, expect, it } from 'vitest';
import {
	formatLocalizedDate,
	formatLocalizedDateTime,
	formatLocalizedShiftTime,
	ticketI18n
} from './ticket.i18n';
import { ticketStatusLabel } from '../domain/volunteer';

describe('ticket.i18n and formatters', () => {
	it('has complete translation dictionaries for th and en', () => {
		const thKeys = Object.keys(ticketI18n.th);
		const enKeys = Object.keys(ticketI18n.en);
		expect(thKeys.sort()).toEqual(enKeys.sort());
	});

	it('formats ISO datetime in Thai with BE year and time suffix', () => {
		const iso = '2026-09-05T11:55:00.000Z'; // 18:55 in Asia/Bangkok
		const formattedTh = formatLocalizedDateTime(iso, 'th');
		expect(formattedTh).toContain('2569');
		expect(formattedTh).toContain('น.');
		expect(formattedTh).toContain('18:55');
	});

	it('formats ISO datetime in English with Gregorian year', () => {
		const iso = '2026-09-05T11:55:00.000Z';
		const formattedEn = formatLocalizedDateTime(iso, 'en');
		expect(formattedEn).toContain('2026');
		expect(formattedEn).toContain('Sep');
		expect(formattedEn).toContain('6:55 PM');
	});

	it('formats naive UTC datetime string correctly to Asia/Bangkok time (UTC+7)', () => {
		const naiveIso = '2026-09-05T12:04:00'; // 12:04 UTC = 19:04 (7:04 PM) in Bangkok
		const formattedTh = formatLocalizedDateTime(naiveIso, 'th');
		expect(formattedTh).toContain('2569');
		expect(formattedTh).toContain('19:04');

		const formattedEn = formatLocalizedDateTime(naiveIso, 'en');
		expect(formattedEn).toContain('2026');
		expect(formattedEn).toContain('7:04 PM');
	});

	it('honors an explicit local offset without applying Bangkok conversion twice', () => {
		const offsetIso = '2026-09-05T12:04:00+07:00';
		const formattedTh = formatLocalizedDateTime(offsetIso, 'th');

		expect(formattedTh).toContain('12:04');
	});

	it('formats ISO date into Thai and English full dates', () => {
		const dateStr = '2026-09-02';
		const thDate = formatLocalizedDate(dateStr, 'th');
		expect(thDate).toContain('กันยายน');
		expect(thDate).toContain('2569');
		expect(thDate).toContain('2');

		const enDate = formatLocalizedDate(dateStr, 'en');
		expect(enDate).toContain('September');
		expect(enDate).toContain('2026');
		expect(enDate).toContain('2');
	});

	it('formats shift times in Thai and English', () => {
		expect(formatLocalizedShiftTime('08:00', '12:00', 'th')).toBe('08:00 - 12:00 น.');
		expect(formatLocalizedShiftTime('08:00', '12:00', 'en')).toBe('08:00 - 12:00');
		expect(formatLocalizedShiftTime('08:00', null, 'th')).toBe('08:00 น.');
		expect(formatLocalizedShiftTime(null, null, 'th')).toBe('');
	});

	it('maps ticketStatusLabel in both languages', () => {
		expect(ticketStatusLabel('confirmed', 'th')).toBe('ยืนยันแล้ว');
		expect(ticketStatusLabel('confirmed', 'en')).toBe('Confirmed');
		expect(ticketStatusLabel('pending_review', 'th')).toBe('รอการพิจารณา');
		expect(ticketStatusLabel('pending_review', 'en')).toBe('Pending Review');
		expect(ticketStatusLabel('cancelled', 'th')).toBe('ยกเลิกแล้ว');
		expect(ticketStatusLabel('cancelled', 'en')).toBe('Cancelled');
	});
});
