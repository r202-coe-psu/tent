import { describe, expect, it } from 'vitest';
import { buildDonationMap, type DonationMapPoint, type DonationNeedsEntry } from './donation-map';
import type { PublicShelterItem } from './types';

function needsEntry(code: string, overrides: Partial<DonationNeedsEntry> = {}): DonationNeedsEntry {
	return {
		code,
		name: `ศูนย์ ${code}`,
		needs: [
			{ item_id: 'item:rice', name: 'ข้าวสาร', unit: 'kg', qty_needed: '50', status: 'open' }
		],
		...overrides
	};
}

function publicShelter(
	code: string,
	overrides: Partial<PublicShelterItem> = {}
): PublicShelterItem {
	return {
		code,
		name: `ศูนย์ ${code}`,
		site_kind: 'evacuation_center',
		status: 'open',
		capacity: 100,
		geo: { lat: 7.0, lng: 100.4 },
		province: 'สงขลา',
		district: 'หาดใหญ่',
		subdistrict: 'หาดใหญ่',
		accepts_pre_registration: true,
		updated_at: '2026-10-26T00:00:00Z',
		...overrides
	};
}

describe('buildDonationMap', () => {
	it('joins needs with public shelters by code', () => {
		const { onMap, withoutGeo } = buildDonationMap(
			[needsEntry('SH001')],
			[publicShelter('SH001')],
			null
		);
		expect(withoutGeo).toEqual([]);
		expect(onMap).toHaveLength(1);
		expect(onMap[0]).toMatchObject({
			code: 'SH001',
			geo: { lat: 7.0, lng: 100.4 },
			status: 'open',
			areaLabel: 'หาดใหญ่ หาดใหญ่ สงขลา'
		});
	});

	it('matches codes ignoring case and surrounding spaces', () => {
		const { onMap } = buildDonationMap([needsEntry('sh001')], [publicShelter(' SH001 ')], null);
		expect(onMap.map((s) => s.code)).toEqual(['sh001']);
	});

	it('puts a shelter without geo in withoutGeo', () => {
		const { onMap, withoutGeo } = buildDonationMap(
			[needsEntry('SH001')],
			[publicShelter('SH001', { geo: null })],
			null
		);
		expect(onMap).toEqual([]);
		expect(withoutGeo.map((s) => s.code)).toEqual(['SH001']);
	});

	it('treats a 0,0 coordinate as no geo', () => {
		const { withoutGeo } = buildDonationMap(
			[needsEntry('SH001')],
			[publicShelter('SH001', { geo: { lat: 0, lng: 0 } })],
			null
		);
		expect(withoutGeo).toHaveLength(1);
	});

	it('keeps a needs shelter that is missing from the public list, listed without geo', () => {
		const { onMap, withoutGeo } = buildDonationMap([needsEntry('SH009')], [], null);
		expect(onMap).toEqual([]);
		expect(withoutGeo).toMatchObject([{ code: 'SH009', geo: null, areaLabel: '', status: '' }]);
	});

	it('ignores public shelters that asked for nothing', () => {
		const { onMap, withoutGeo } = buildDonationMap(
			[needsEntry('SH001')],
			[publicShelter('SH001'), publicShelter('SH002')],
			null
		);
		expect([...onMap, ...withoutGeo].map((s) => s.code)).toEqual(['SH001']);
	});

	it('narrows to the locked shelter', () => {
		const { onMap, withoutGeo } = buildDonationMap(
			[needsEntry('SH001'), needsEntry('SH002')],
			[publicShelter('SH001'), publicShelter('SH002')],
			'SH002'
		);
		expect(withoutGeo).toEqual([]);
		expect(onMap.map((s) => s.code)).toEqual(['SH002']);
	});

	it('returns nothing when the locked shelter is not in needs', () => {
		const result = buildDonationMap([needsEntry('SH001')], [publicShelter('SH001')], 'SH404');
		expect(result).toEqual({ onMap: [], withoutGeo: [] });
	});

	it('drops closed needs and ranks the rest by urgency, keeping board order within a level', () => {
		const { onMap } = buildDonationMap(
			[
				needsEntry('SH001', {
					needs: [
						{ item_id: 'item:a', name: 'A', qty_needed: 1, urgency: 'normal' },
						{ item_id: 'item:b', name: 'B', qty_needed: 1, urgency: 'important' },
						{ item_id: 'item:c', name: 'C', qty_needed: 0, status: 'closed' },
						{ item_id: 'item:d', name: 'D', qty_needed: 1, urgency: 'critical' },
						{ item_id: 'item:e', name: 'E', qty_needed: 1, urgency: 'normal' }
					]
				})
			],
			[publicShelter('SH001')],
			null
		);
		expect(onMap[0].needs.map((n) => [n.name, n.urgency])).toEqual([
			['D', 'critical'],
			['B', 'high'],
			['A', 'normal'],
			['E', 'normal']
		]);
	});

	it('reads qty_needed from a string or a number', () => {
		const { onMap } = buildDonationMap(
			[
				needsEntry('SH001', {
					needs: [
						{ item_id: 'item:a', qty_needed: '12.5' },
						{ item_id: 'item:b', qty_needed: 3 }
					]
				})
			],
			[publicShelter('SH001')],
			null
		);
		expect(onMap[0].needs.map((n) => n.qtyNeeded)).toEqual([12.5, 3]);
	});

	it('attaches drop-off points to their shelter only', () => {
		const point = (id: string, shelterCode: string): DonationMapPoint => ({
			id,
			shelterCode,
			geo: { lat: 7.01, lng: 100.41 },
			label: id
		});
		const { onMap } = buildDonationMap(
			[needsEntry('SH001'), needsEntry('SH002')],
			[publicShelter('SH001'), publicShelter('SH002')],
			null,
			{ SH001: [point('p1', 'SH001')], SH002: [point('p2', 'SH002')] }
		);
		expect(onMap.map((s) => s.points.map((p) => p.id))).toEqual([['p1'], ['p2']]);
	});

	it('has no points when none are supplied', () => {
		const { onMap } = buildDonationMap([needsEntry('SH001')], [publicShelter('SH001')], null);
		expect(onMap[0].points).toEqual([]);
	});

	it('still places a shelter with no needs when it is locked (the form map)', () => {
		const { onMap } = buildDonationMap(
			[{ code: 'SH001', name: 'ศูนย์ SH001', needs: [] }],
			[publicShelter('SH001')],
			'SH001'
		);
		expect(onMap).toHaveLength(1);
		expect(onMap[0]).toMatchObject({ code: 'SH001', needs: [], geo: { lat: 7.0, lng: 100.4 } });
	});
});
