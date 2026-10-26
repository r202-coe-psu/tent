import { describe, expect, it } from 'vitest';
import { ONSITE_STATIONS, resolveOnsiteStation } from './onsite-station';

describe('ONSITE_STATIONS', () => {
	it('lists the three registration stations in walk-through order', () => {
		expect(ONSITE_STATIONS.map((s) => s.id)).toEqual([1, 2, 3]);
	});

	it('reads routes off the portal menu', () => {
		expect(ONSITE_STATIONS.map((s) => s.path)).toEqual([
			'/onsite/people',
			'/onsite/medical-screening',
			'/onsite/zoning'
		]);
	});

	it('carries the menu label for each station', () => {
		for (const station of ONSITE_STATIONS) expect(station.label.length).toBeGreaterThan(0);
	});
});

describe('resolveOnsiteStation', () => {
	it.each([
		['/onsite/people', 1],
		['/onsite/medical-screening', 2],
		['/onsite/zoning', 3]
	])('%s is station %s', (path, id) => {
		expect(resolveOnsiteStation(path)?.id).toBe(id);
	});

	it.each([
		'/onsite/zoning/evacuee:seed-st:sh001:0022',
		'/onsite/medical-screening/evacuee:abc',
		'/onsite/people/new'
	])('matches nested route %s', (path) => {
		expect(resolveOnsiteStation(path)).not.toBeNull();
	});

	it('ignores a trailing slash', () => {
		expect(resolveOnsiteStation('/onsite/zoning/')?.id).toBe(3);
	});

	it.each([
		'/onsite',
		'/onsite/search-edit',
		'/onsite/scan-check-in-out',
		'/onsite/distribution',
		'/portal'
	])('%s is not a station page', (path) => {
		expect(resolveOnsiteStation(path)).toBeNull();
	});

	it('does not match a route that merely starts with a station path', () => {
		expect(resolveOnsiteStation('/onsite/zoning-report')).toBeNull();
	});
});
