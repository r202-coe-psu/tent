import { describe, expect, it } from 'vitest';
import { isInShelterStatus, toPublicShelterCard, toUiShelterStatus } from './mappers';
import type { PublicShelterItem } from './types';

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

describe('isInShelterStatus', () => {
	it('recognizes FastAPI public status', () => {
		expect(isInShelterStatus('in_shelter')).toBe(true);
		expect(isInShelterStatus('moved')).toBe(false);
		expect(isInShelterStatus(null)).toBe(false);
		expect(isInShelterStatus(undefined)).toBe(false);
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
		expect(card.distance).toBe(3.2);
		expect(card.geo).toEqual({ lat: 7, lng: 100 });
	});

	it('handles null, undefined, or empty shelter item gracefully without throwing', () => {
		const emptyCard = toPublicShelterCard(null);
		expect(emptyCard.id).toBe('ศูนย์พักพิง');
		expect(emptyCard.status).toBe('CLOSED');
		expect(emptyCard.capacity).toBe(0);
		expect(emptyCard.distance).toBe(0);
		expect(emptyCard.geo).toBeNull();
		expect(emptyCard.vulnerable_groups).toBeNull();

		const undefinedCard = toPublicShelterCard(undefined);
		expect(undefinedCard.id).toBe('ศูนย์พักพิง');
		expect(undefinedCard.status).toBe('CLOSED');

		const partialCard = toPublicShelterCard({});
		expect(partialCard.status).toBe('CLOSED');
		expect(partialCard.name).toBe('ศูนย์พักพิง');
	});
});
