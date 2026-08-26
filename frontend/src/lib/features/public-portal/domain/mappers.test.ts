import { describe, expect, it } from 'vitest';
import { searchResultKey, toPublicShelterCard, toUiShelterStatus } from './mappers';
import type { FamilySearchResult, PublicShelterItem } from './types';

describe('toUiShelterStatus', () => {
	it('maps open/full/closed', () => {
		expect(toUiShelterStatus('open')).toBe('OPEN');
		expect(toUiShelterStatus('full')).toBe('FULL');
		expect(toUiShelterStatus('closed')).toBe('CLOSED');
	});

	it('handles empty or invalid status safely', () => {
		expect(toUiShelterStatus('')).toBe('CLOSED');
		expect(toUiShelterStatus(null)).toBe('CLOSED');
		expect(toUiShelterStatus(undefined)).toBe('CLOSED');
	});
});

describe('toPublicShelterCard', () => {
	it('maps ShelterItem to card model without occupancy', () => {
		const item: PublicShelterItem = {
			code: 'SH001',
			name: 'ศูนย์ทดสอบ',
			status: 'open',
			capacity: 100,
			geo: { lat: 7, lng: 100 },
			province: 'สงขลา',
			district: 'หาดใหญ่',
			subdistrict: 'หาดใหญ่',
			updated_at: '2026-07-16T00:00:00Z'
		};
		const card = toPublicShelterCard(item, 3.2);
		expect(card.id).toBe('SH001');
		expect(card.status).toBe('OPEN');
		expect(card.capacity).toBe(100);
		expect(card.site_kind).toBe('evacuation_center');
		expect(card.distance).toBe(3.2);
		expect(card.geo).toEqual({ lat: 7, lng: 100 });
	});

	it('preserves host house site kind', () => {
		const card = toPublicShelterCard({
			code: 'SH002',
			name: 'บ้านทดสอบ',
			status: 'open',
			capacity: 10,
			site_kind: 'host_house'
		});
		expect(card.site_kind).toBe('host_house');
	});

	it('handles null, undefined, or empty shelter item gracefully without throwing', () => {
		const emptyCard = toPublicShelterCard(null);
		expect(emptyCard.id).toBe('ศูนย์พักพิง');
		expect(emptyCard.status).toBe('CLOSED');
		expect(emptyCard.capacity).toBe(0);
		expect(emptyCard.distance).toBe(0);
		expect(emptyCard.geo).toBeNull();
		expect(emptyCard.site_kind).toBe('evacuation_center');
		expect(emptyCard.vulnerable_groups).toBeNull();

		const undefinedCard = toPublicShelterCard(undefined);
		expect(undefinedCard.id).toBe('ศูนย์พักพิง');
		expect(undefinedCard.status).toBe('CLOSED');

		const partialCard = toPublicShelterCard({});
		expect(partialCard.status).toBe('CLOSED');
		expect(partialCard.name).toBe('ศูนย์พักพิง');
	});
});

describe('searchResultKey', () => {
	// Observed on /search: one person who booked twice at the same shelter comes
	// back as two rows agreeing on every field the public API exposes (the surname
	// and the national ID are both masked), which crashed the list with
	// `each_key_duplicate`. Nothing in the payload can tell them apart, so the key
	// has to carry position too.
	it('stays unique when two results are identical on every visible field', () => {
		const row = {
			shelter_name: 'ศูนย์อพยพ ม.อ.',
			name: 'สักก์ธนัชญ์ พี****',
			national_id: '111-XXXX-XX-111'
		} as FamilySearchResult;

		expect(searchResultKey(row, 0)).not.toBe(searchResultKey(row, 1));
	});

	it('keeps the identity in the key, so it is not a bare index', () => {
		const row = { shelter_name: 'ศูนย์ A', name: 'สมชาย ใ***' } as FamilySearchResult;
		expect(searchResultKey(row, 2)).toBe('ศูนย์ A:สมชาย ใ***:no-id:2');
	});

	it('survives a null result', () => {
		expect(searchResultKey(null as unknown as FamilySearchResult, 4)).toBe('result-4');
	});
});
