import { describe, it, expect } from 'vitest';
import { PUBLIC_ALERTS_PANEL_I18N } from './public-home';
import { getTranslation } from '$lib/utils/i18n';

describe('PUBLIC_ALERTS_PANEL_I18N dictionary', () => {
	it('has complete parity between Thai and English keys', () => {
		const thKeys = Object.keys(PUBLIC_ALERTS_PANEL_I18N.th).sort();
		const enKeys = Object.keys(PUBLIC_ALERTS_PANEL_I18N.en).sort();

		expect(thKeys).toEqual(enKeys);
	});

	it('returns proper Thai translations for title and viewAll', () => {
		const t = getTranslation(PUBLIC_ALERTS_PANEL_I18N, 'th');
		expect(t.title).toBe('ประกาศแจ้งเตือน');
		expect(t.viewAll).toBe('ดูประกาศทั้งหมด →');
	});

	it('does not mention EOC in titles or descriptions', () => {
		const allThText = Object.values(PUBLIC_ALERTS_PANEL_I18N.th).join(' ');
		const allEnText = Object.values(PUBLIC_ALERTS_PANEL_I18N.en).join(' ');

		expect(allThText).not.toContain('EOC');
		expect(allThText).not.toContain('ศูนย์บัญชาการสถานการณ์');
		expect(allEnText).not.toContain('EOC');
		expect(allEnText).not.toContain('Emergency Operations Center');
	});

	it('does not contain deprecated text', () => {
		const allThText = Object.values(PUBLIC_ALERTS_PANEL_I18N.th).join(' ');
		expect(allThText).not.toContain('การแจ้งเตือนภัยฉุกเฉิน');
		expect(allThText).not.toContain('ดูรายละเอียดประกาศทั้งหมด');
	});
});
