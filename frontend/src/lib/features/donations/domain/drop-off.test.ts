import { describe, expect, it } from 'vitest';
import {
	dropOffDirectionsUrl,
	needsDropOffDestination,
	resolveDropOffPoint,
	type DropOffShelterSource
} from './drop-off';

const SHELTER: DropOffShelterSource = {
	id: 'SH001',
	name: 'ศูนย์พักพิงหาดใหญ่',
	address: '1 ถ.เพชรเกษม อ.หาดใหญ่ จ.สงขลา',
	geo: { lat: 7.0086, lng: 100.4747 }
};

describe('resolveDropOffPoint', () => {
	it('resolves the shelter itself as the main point', () => {
		expect(resolveDropOffPoint(SHELTER)).toEqual({
			shelterCode: 'SH001',
			shelterName: 'ศูนย์พักพิงหาดใหญ่',
			pointId: null,
			name: 'ศูนย์พักพิงหาดใหญ่',
			address: '1 ถ.เพชรเกษม อ.หาดใหญ่ จ.สงขลา',
			note: null,
			geo: { lat: 7.0086, lng: 100.4747 }
		});
	});

	it('prefers code over id for the shelter code', () => {
		expect(resolveDropOffPoint({ ...SHELTER, code: 'SH-X' }).shelterCode).toBe('SH-X');
	});

	it('keeps geo null when the shelter has no coordinates', () => {
		expect(resolveDropOffPoint({ ...SHELTER, geo: null }).geo).toBeNull();
		expect(resolveDropOffPoint({ ...SHELTER, geo: undefined }).geo).toBeNull();
		expect(resolveDropOffPoint({ ...SHELTER, geo: { lat: Number.NaN, lng: 1 } }).geo).toBeNull();
	});

	it('drops the unset (0,0) location and out-of-range coordinates', () => {
		expect(resolveDropOffPoint({ ...SHELTER, geo: { lat: 0, lng: 0 } }).geo).toBeNull();
		expect(resolveDropOffPoint({ ...SHELTER, geo: { lat: 91, lng: 100 } }).geo).toBeNull();
		expect(resolveDropOffPoint({ ...SHELTER, geo: { lat: 7, lng: -181 } }).geo).toBeNull();
		expect(resolveDropOffPoint({ ...SHELTER, geo: { lat: 0, lng: 100.5 } }).geo).toEqual({
			lat: 0,
			lng: 100.5
		});
	});

	it('treats a missing or blank address as null', () => {
		expect(resolveDropOffPoint({ ...SHELTER, address: null }).address).toBeNull();
		expect(resolveDropOffPoint({ ...SHELTER, address: undefined }).address).toBeNull();
		expect(resolveDropOffPoint({ ...SHELTER, address: '   ' }).address).toBeNull();
	});

	it('treats the FastAPI "unspecified" placeholder as no address', () => {
		expect(resolveDropOffPoint({ ...SHELTER, address: 'unspecified' }).address).toBeNull();
		expect(resolveDropOffPoint({ ...SHELTER, address: ' unspecified ' }).address).toBeNull();
	});
});

describe('dropOffDirectionsUrl', () => {
	it('links to the point coordinates', () => {
		expect(dropOffDirectionsUrl(resolveDropOffPoint(SHELTER))).toBe(
			'https://www.google.com/maps/dir/?api=1&destination=7.0086,100.4747'
		);
	});

	it('is null without coordinates', () => {
		expect(dropOffDirectionsUrl(resolveDropOffPoint({ ...SHELTER, geo: null }))).toBeNull();
	});
});

describe('needsDropOffDestination', () => {
	it('is true when the donor or a courier goes to the shelter', () => {
		expect(needsDropOffDestination('self_dropoff')).toBe(true);
		expect(needsDropOffDestination('parcel')).toBe(true);
	});

	it('is false when the shelter collects, or the method is unknown', () => {
		expect(needsDropOffDestination('shelter_pickup')).toBe(false);
		expect(needsDropOffDestination(undefined)).toBe(false);
		expect(needsDropOffDestination(null)).toBe(false);
	});
});
