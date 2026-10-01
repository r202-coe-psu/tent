import { describe, it, expect } from 'vitest';
import {
	APP_CONFIG_DEFAULTS,
	bannerPatchSchema,
	isBannerVisible,
	readAppConfig,
	toSystemBanner
} from './app-config';

describe('readAppConfig', () => {
	it('falls back to the spec defaults when the document is missing', () => {
		expect(readAppConfig(undefined)).toEqual(APP_CONFIG_DEFAULTS);
		expect(readAppConfig(null)).toEqual(APP_CONFIG_DEFAULTS);
	});

	it('defaults the donation TTL to 72 hours (schema.md §3.2)', () => {
		expect(APP_CONFIG_DEFAULTS.donation_reservation_ttl_hours).toBe(72);
	});

	it('defaults recaptcha_enabled to true (operator can turn off in System Management)', () => {
		expect(APP_CONFIG_DEFAULTS.recaptcha_enabled).toBe(true);
		expect(readAppConfig({ type: 'config' }).recaptcha_enabled).toBe(true);
	});

	it('honors an operator-disabled reCAPTCHA flag', () => {
		expect(readAppConfig({ recaptcha_enabled: false }).recaptcha_enabled).toBe(false);
	});

	it('defaults thaid_registration_enabled to true (operator can turn off in System Management)', () => {
		expect(APP_CONFIG_DEFAULTS.thaid_registration_enabled).toBe(true);
		expect(readAppConfig({ type: 'config' }).thaid_registration_enabled).toBe(true);
	});

	it('honors an operator-disabled ThaiD registration flag', () => {
		expect(readAppConfig({ thaid_registration_enabled: false }).thaid_registration_enabled).toBe(
			false
		);
	});

	it('reads an operator-tuned TTL', () => {
		const config = readAppConfig({ type: 'config', donation_reservation_ttl_hours: 24 });
		expect(config.donation_reservation_ttl_hours).toBe(24);
	});

	it('coerces a numeric string, since CouchDB holds whatever was written', () => {
		expect(
			readAppConfig({ donation_reservation_ttl_hours: '48' }).donation_reservation_ttl_hours
		).toBe(48);
	});

	it.each([0, -5, 1.5, 'soon', null])('rejects %p and keeps the default TTL', (bad) => {
		expect(
			readAppConfig({ donation_reservation_ttl_hours: bad }).donation_reservation_ttl_hours
		).toBe(72);
	});

	it('lets one bad field fall back without discarding the others', () => {
		const config = readAppConfig({
			donation_reservation_ttl_hours: 12,
			fam_search_max_results: 'not a number'
		});
		expect(config.donation_reservation_ttl_hours).toBe(12);
		expect(config.fam_search_max_results).toBe(10);
	});

	it('keeps unknown future fields from breaking the read', () => {
		const config = readAppConfig({ donation_reservation_ttl_hours: 6, something_new: true });
		expect(config.donation_reservation_ttl_hours).toBe(6);
	});

	it('ignores a non-object document', () => {
		expect(readAppConfig('config:app')).toEqual(APP_CONFIG_DEFAULTS);
	});

	it('keeps the password form hidden unless explicitly enabled (CR-141)', () => {
		expect(APP_CONFIG_DEFAULTS.password_login_enabled).toBe(false);
		expect(readAppConfig({ password_login_enabled: 'yes' }).password_login_enabled).toBe(false);
		expect(readAppConfig({ password_login_enabled: true }).password_login_enabled).toBe(true);
	});
});

describe('system banner settings', () => {
	it('defaults to hidden with the warning variant', () => {
		expect(APP_CONFIG_DEFAULTS.banner_enabled).toBe(false);
		expect(APP_CONFIG_DEFAULTS.banner_message).toBe('');
		expect(APP_CONFIG_DEFAULTS.banner_variant).toBe('warning');
		expect(isBannerVisible(APP_CONFIG_DEFAULTS)).toBe(false);
	});

	it('hides the banner when enabled but the message is empty or whitespace', () => {
		expect(isBannerVisible(readAppConfig({ banner_enabled: true }))).toBe(false);
		expect(isBannerVisible(readAppConfig({ banner_enabled: true, banner_message: '   ' }))).toBe(
			false
		);
	});

	it('shows the banner when enabled with a message, trimming it', () => {
		const cfg = readAppConfig({ banner_enabled: true, banner_message: '  ปิดปรับปรุง  ' });
		expect(isBannerVisible(cfg)).toBe(true);
		expect(cfg.banner_message).toBe('ปิดปรับปรุง');
	});

	it('hides the banner when the message is present but the switch is off', () => {
		expect(isBannerVisible(readAppConfig({ banner_enabled: false, banner_message: 'x' }))).toBe(
			false
		);
	});

	it('falls back to warning for an unknown variant', () => {
		expect(readAppConfig({ banner_variant: 'rainbow' }).banner_variant).toBe('warning');
	});

	it('reads an over-long or multi-line message as empty', () => {
		expect(readAppConfig({ banner_message: 'x'.repeat(121) }).banner_message).toBe('');
		expect(readAppConfig({ banner_message: 'a\nb' }).banner_message).toBe('');
	});

	it('strict patch schema rejects what the reader would silently default', () => {
		const ok = { banner_enabled: true, banner_message: 'ok', banner_variant: 'info' };
		expect(bannerPatchSchema.safeParse(ok).success).toBe(true);
		expect(bannerPatchSchema.safeParse({ ...ok, banner_message: 'x'.repeat(121) }).success).toBe(
			false
		);
		expect(bannerPatchSchema.safeParse({ ...ok, banner_message: 'a\nb' }).success).toBe(false);
		expect(bannerPatchSchema.safeParse({ ...ok, banner_variant: 'foo' }).success).toBe(false);
	});

	it('projects a hidden banner as disabled with no message', () => {
		const hidden = toSystemBanner(readAppConfig({ banner_enabled: true, banner_message: '' }));
		expect(hidden).toEqual({ enabled: false, message: '', variant: 'warning' });
		const shown = toSystemBanner(
			readAppConfig({ banner_enabled: true, banner_message: 'hi', banner_variant: 'destructive' })
		);
		expect(shown).toEqual({ enabled: true, message: 'hi', variant: 'destructive' });
	});
});
