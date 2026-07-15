import { describe, expect, it } from 'vitest';
import { isInShelterStatus, toPublicShelterCard, toUiShelterStatus } from './mappers';
import type { PublicShelterItem } from './types';

describe('toUiShelterStatus', () => {
	it('maps open/full/closed', () => {
		expect(toUiShelterStatus('open')).toBe('OPEN');
		expect(toUiShelterStatus('full')).toBe('FULL');
		expect(toUiShelterStatus('closed')).toBe('CLOSED');
	});
});

describe('isInShelterStatus', () => {
	it('recognizes FastAPI public status', () => {
		expect(isInShelterStatus('in_shelter')).toBe(true);
		expect(isInShelterStatus('moved')).toBe(false);
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
});
