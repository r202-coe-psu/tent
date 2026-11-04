import { describe, expect, it } from 'vitest';
import {
	donationMapPointsOf,
	buildDonationMap,
	donationNeedUrgency,
	donationShelterUrgency,
	type DonationMapPoint,
	type DonationNeedsEntry
} from './donation-map';
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

	it('ranks a need without a set level by what is still short, like the board', () => {
		const { onMap } = buildDonationMap(
			[
				needsEntry('SH001', {
					needs: [
						{ item_id: 'item:a', qty_needed: 50 },
						{ item_id: 'item:b', qty_needed: 3, urgency: '' },
						{ item_id: 'item:c', qty_needed: 0 },
						{ item_id: 'item:d', qty_needed: 80, urgency: 'normal' }
					]
				})
			],
			[publicShelter('SH001')],
			null
		);
		expect(onMap[0].needs.map((n) => [n.itemId, n.urgency])).toEqual([
			['item:a', 'critical'],
			['item:b', 'high'],
			['item:c', 'normal'],
			['item:d', 'normal']
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

describe('donationNeedUrgency', () => {
	it('takes the level staff set, reading back-office `important` as high', () => {
		expect(donationNeedUrgency('critical', 0)).toBe('critical');
		expect(donationNeedUrgency('important', 999)).toBe('high');
		expect(donationNeedUrgency('high', 999)).toBe('high');
		expect(donationNeedUrgency(' normal ', 999)).toBe('normal');
	});

	it('ranks a need with no level by what is still short', () => {
		expect(donationNeedUrgency(undefined, 50)).toBe('critical');
		expect(donationNeedUrgency('', '3')).toBe('high');
		expect(donationNeedUrgency(undefined, 0)).toBe('normal');
	});
});

describe('donationShelterUrgency', () => {
	it('takes the most urgent open need', () => {
		expect(
			donationShelterUrgency([
				{ item_id: 'item:a', urgency: 'normal' },
				{ item_id: 'item:b', urgency: 'important' }
			])
		).toBe('high');
		expect(
			donationShelterUrgency([
				{ item_id: 'item:a', urgency: 'high' },
				{ item_id: 'item:b', urgency: 'critical' }
			])
		).toBe('critical');
	});

	it('skips closed needs and is normal with none open', () => {
		expect(
			donationShelterUrgency([{ item_id: 'item:a', urgency: 'critical', status: 'closed' }])
		).toBe('normal');
		expect(donationShelterUrgency([])).toBe('normal');
		expect(donationShelterUrgency(undefined)).toBe('normal');
	});

	it('counts a need without an item_id, so the pin matches the card badge', () => {
		expect(donationShelterUrgency([{ name: 'ไม่มีรหัส', urgency: 'critical' }])).toBe('critical');
	});
});

describe('donationMapPointsOf', () => {
	it('turns each ticked point of the detail into a pin of that shelter', () => {
		expect(
			donationMapPointsOf('SH001', [
				{ id: 'p1', name: 'โรงยิม', geo: { lat: 7.01, lng: 100.41 }, location_note: ' ประตู 2 ' },
				{ id: 'p2', name: 'ห้องพยาบาล', geo: { lat: 7.02, lng: 100.42 }, location_note: null }
			])
		).toEqual([
			{
				id: 'p1',
				shelterCode: 'SH001',
				geo: { lat: 7.01, lng: 100.41 },
				label: 'โรงยิม',
				description: 'ประตู 2'
			},
			{
				id: 'p2',
				shelterCode: 'SH001',
				geo: { lat: 7.02, lng: 100.42 },
				label: 'ห้องพยาบาล',
				description: undefined
			}
		]);
	});

	it('skips a point at (0,0) or out of range rather than pin it off the map', () => {
		expect(
			donationMapPointsOf('SH001', [
				{ id: 'zero', name: 'ศูนย์', geo: { lat: 0, lng: 0 } },
				{ id: 'far', name: 'นอกโลก', geo: { lat: 7, lng: 200 } },
				{ id: 'ok', name: 'โรงยิม', geo: { lat: 7.01, lng: 100.41 } }
			]).map((p) => p.id)
		).toEqual(['ok']);
	});

	it('adds no pin for a shelter without ticked points (FR-DP-18)', () => {
		expect(donationMapPointsOf('SH001', [])).toEqual([]);
		expect(donationMapPointsOf('SH001', undefined)).toEqual([]);
	});
});

describe('one item at several drop-off points (CR-206 A2 FR-AP-29)', () => {
	const rows: DonationNeedsEntry['needs'] = [
		{
			item_id: 'item:rice',
			name: 'ข้าวสาร',
			unit: 'kg',
			qty_needed: '30',
			urgency: 'normal',
			status: 'open',
			drop_off_point_id: 'point-gym',
			drop_off_point_name: 'โรงยิม'
		},
		{
			item_id: 'item:rice',
			name: 'ข้าวสาร',
			unit: 'kg',
			qty_needed: '20',
			urgency: 'critical',
			status: 'open',
			drop_off_point_id: 'point-med',
			drop_off_point_name: 'ห้องพยาบาล'
		},
		{ item_id: 'item:soap', name: 'สบู่', unit: 'bar', qty_needed: '5', status: 'open' }
	];

	it('counts the item once on the map and keeps its most urgent level', () => {
		const { onMap } = buildDonationMap(
			[needsEntry('SH001', { needs: rows })],
			[publicShelter('SH001')],
			null
		);

		expect(onMap[0].needs.map((n) => n.itemId)).toEqual(['item:rice', 'item:soap']);
		expect(onMap[0].needs[0]).toMatchObject({ qtyNeeded: 50, urgency: 'critical' });
	});

	it('rates the shelter by its most urgent open row', () => {
		expect(donationShelterUrgency(rows)).toBe('critical');
	});
});
