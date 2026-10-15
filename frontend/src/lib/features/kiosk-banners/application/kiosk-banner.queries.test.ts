import { describe, expect, it } from 'vitest';
import { KioskBannerApiError } from '../data/kiosk-banner.repository';
import { kioskBannerErrorMessage, kioskBannerKeys } from './kiosk-banner.queries';

describe('kioskBannerKeys', () => {
	it('nests list and detail keys under all so one invalidation covers both', () => {
		const all = kioskBannerKeys.all;
		expect(kioskBannerKeys.list('SH-01', 'current').slice(0, all.length)).toEqual(all);
		expect(kioskBannerKeys.detail('kiosk_banner:1').slice(0, all.length)).toEqual(all);
	});

	it('separates shelters and views', () => {
		expect(kioskBannerKeys.list('SH-01', 'current')).not.toEqual(
			kioskBannerKeys.list('SH-01', 'expired')
		);
		expect(kioskBannerKeys.list('SH-01', 'current')).not.toEqual(
			kioskBannerKeys.list('SH-02', 'current')
		);
		expect(kioskBannerKeys.detail('a')).not.toEqual(kioskBannerKeys.detail('b'));
	});
});

describe('kioskBannerErrorMessage', () => {
	it('uses the dedicated reload message for 409', () => {
		const error = new KioskBannerApiError(409, 'CONFLICT', 'Document update conflict');
		expect(kioskBannerErrorMessage(error)).toBe('มีผู้อื่นแก้ไขแบนเนอร์นี้ โปรดโหลดใหม่');
	});

	it('passes through the server message for other API errors', () => {
		const error = new KioskBannerApiError(422, 'VALIDATION', 'รูปภาพต้องมีขนาดไม่เกิน 2 MB');
		expect(kioskBannerErrorMessage(error)).toBe('รูปภาพต้องมีขนาดไม่เกิน 2 MB');
	});

	it('falls back for unknown errors', () => {
		expect(kioskBannerErrorMessage(new Error('boom'), 'บันทึกไม่สำเร็จ')).toBe('boom');
		expect(kioskBannerErrorMessage('x', 'บันทึกไม่สำเร็จ')).toBe('บันทึกไม่สำเร็จ');
	});
});
