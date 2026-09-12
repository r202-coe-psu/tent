import { describe, it, expect } from 'vitest';
import { DEFAULT_MAP_ZOOM } from '$lib/constants/maps';
import { PUBLIC_SHELTER_MAP_I18N } from '$lib/constants/i18n/public-shelter-map';
import { PUBLIC_SHELTER_CARD_I18N } from '$lib/constants/i18n/public-shelter-card';
import { toPublicShelterCard } from '../domain/mappers';

describe('Shelter Map Synchronization & Booking UI Logic', () => {
	it('has default map zoom level increased to 13', () => {
		expect(DEFAULT_MAP_ZOOM).toBe(13);
	});

	it('provides required i18n keys for map popup actions and card selection', () => {
		expect(PUBLIC_SHELTER_MAP_I18N.th.preRegister).toBe('ลงทะเบียนจองล่วงหน้า');
		expect(PUBLIC_SHELTER_MAP_I18N.th.viewDetails).toBe('ดูรายละเอียด');
		expect(PUBLIC_SHELTER_MAP_I18N.th.shelterClosed).toBe('ศูนย์ปิดแล้ว');

		expect(PUBLIC_SHELTER_MAP_I18N.en.preRegister).toBe('Pre-register');
		expect(PUBLIC_SHELTER_MAP_I18N.en.viewDetails).toBe('View Details');
		expect(PUBLIC_SHELTER_MAP_I18N.en.shelterClosed).toBe('Shelter Closed');

		expect(PUBLIC_SHELTER_CARD_I18N.th.selectedShelter).toBe('ศูนย์ที่เลือก');
		expect(PUBLIC_SHELTER_CARD_I18N.en.selectedShelter).toBe('Selected Shelter');
	});

	it('computes canBook correctly across shelter statuses', () => {
		const canBookLogic = (status: string, code?: string) => Boolean(code) && status !== 'CLOSED';

		const openCard = toPublicShelterCard({ code: 'SH01', status: 'open' });
		const fullCard = toPublicShelterCard({ code: 'SH02', status: 'full' });
		const prepareCard = toPublicShelterCard({ code: 'SH03', status: 'standby' });
		const closedCard = toPublicShelterCard({ code: 'SH04', status: 'closed' });
		const noCodeCard = toPublicShelterCard({ name: 'ไม่มีรหัส', status: 'open' });

		expect(canBookLogic(openCard.status, openCard.code)).toBe(true);
		expect(canBookLogic(fullCard.status, fullCard.code)).toBe(true);
		expect(canBookLogic(prepareCard.status, prepareCard.code)).toBe(true);
		expect(canBookLogic(closedCard.status, closedCard.code)).toBe(false);
		expect(canBookLogic(noCodeCard.status, noCodeCard.code)).toBe(false);
	});

	it('matches selected shelter correctly by ID or code', () => {
		const isSelected = (selectedId: string | null, shelter: { id: string; code?: string }) =>
			Boolean(
				selectedId && (shelter.id === selectedId || (shelter.code && shelter.code === selectedId))
			);

		const shelterA = { id: 'uuid-123', code: 'SH01' };
		const shelterB = { id: 'SH02', code: 'SH02' };

		// Match by ID
		expect(isSelected('uuid-123', shelterA)).toBe(true);
		// Match by Code
		expect(isSelected('SH01', shelterA)).toBe(true);
		// Non-matching
		expect(isSelected('SH99', shelterA)).toBe(false);
		expect(isSelected(null, shelterA)).toBe(false);

		expect(isSelected('SH02', shelterB)).toBe(true);
	});
});
