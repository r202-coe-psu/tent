import { describe, it, expect } from 'vitest';
import { APP_CONFIG_DEFAULTS, readAppConfig } from './app-config';

describe('readAppConfig', () => {
	it('falls back to the spec defaults when the document is missing', () => {
		expect(readAppConfig(undefined)).toEqual(APP_CONFIG_DEFAULTS);
		expect(readAppConfig(null)).toEqual(APP_CONFIG_DEFAULTS);
	});

	it('defaults the donation TTL to 72 hours (schema.md §3.2)', () => {
		expect(APP_CONFIG_DEFAULTS.donation_reservation_ttl_hours).toBe(72);
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
});
