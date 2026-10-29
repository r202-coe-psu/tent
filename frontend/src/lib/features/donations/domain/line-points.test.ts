import { describe, expect, it } from 'vitest';
import {
	ANY_POINT_KEY,
	AT_SHELTER_KEY,
	bookableDropOffPoints,
	currentDropOffPointIds,
	defaultDropOffPointId,
	dropOffPickerStyle,
	groupDropOffDestinations,
	hasLinePoints,
	lineDestinationResolver,
	lineDropOffPointId,
	withCurrentLinePoints
} from './line-points';
import type { DropOffShelterSource } from './drop-off';

const ANY = 'ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้';

const GYM = {
	id: 'point-gym',
	name: 'โรงยิม',
	geo: { lat: 7.009, lng: 100.4752 },
	location_note: 'ประตู 2'
};
const MED = { id: 'point-med', name: 'ห้องพยาบาล', geo: { lat: 7.01, lng: 100.476 } };

const SHELTER: DropOffShelterSource = {
	code: 'SH001',
	name: 'ศูนย์พักพิงหาดใหญ่',
	address: '1 ถ.เพชรเกษม',
	geo: { lat: 7.0086, lng: 100.4747 },
	donation_points: [GYM, MED]
};

const POINTS = [
	{ id: 'point-gym', name: 'โรงยิม' },
	{ id: 'point-med', name: 'ห้องพยาบาล' }
];

describe('bookableDropOffPoints (FR-MP-8, FR-MP-11)', () => {
	it('offers the shelter points to a donor who brings the goods', () => {
		expect(bookableDropOffPoints(SHELTER, 'self_dropoff')).toEqual(POINTS);
	});

	it('offers none for a parcel or a shelter pickup (FR-MP-4)', () => {
		expect(bookableDropOffPoints(SHELTER, 'parcel')).toEqual([]);
		expect(bookableDropOffPoints(SHELTER, 'shelter_pickup')).toEqual([]);
	});

	it('offers none for a shelter with no point, or before its detail loads', () => {
		expect(bookableDropOffPoints({ ...SHELTER, donation_points: [] }, 'self_dropoff')).toEqual([]);
		expect(bookableDropOffPoints(undefined, 'self_dropoff')).toEqual([]);
	});
});

describe('defaultDropOffPointId (FR-MP-9)', () => {
	it('starts at the point the donor tapped on the map', () => {
		expect(defaultDropOffPointId(POINTS, 'point-med')).toBe('point-med');
	});

	it('starts at the first point when nothing was tapped', () => {
		expect(defaultDropOffPointId(POINTS, null)).toBe('point-gym');
	});

	it("ignores a tap on another shelter's point", () => {
		expect(defaultDropOffPointId(POINTS, 'point-elsewhere')).toBe('point-gym');
	});

	it('has no default without points', () => {
		expect(defaultDropOffPointId([], 'point-med')).toBeNull();
	});
});

describe('lineDropOffPointId', () => {
	it("keeps the donor's own pick", () => {
		expect(lineDropOffPointId('point-med', POINTS, 'point-gym')).toBe('point-med');
	});

	it('falls back to the default without a pick', () => {
		expect(lineDropOffPointId(undefined, POINTS, 'point-gym')).toBe('point-gym');
	});

	it('drops a pick the shelter does not offer — a pick made for another shelter (FR-MP-12)', () => {
		expect(lineDropOffPointId('point-other-shelter', POINTS, 'point-gym')).toBe('point-gym');
	});

	it('fills in the only point without asking (FR-MP-10)', () => {
		const one = [POINTS[0]];
		expect(lineDropOffPointId(undefined, one, defaultDropOffPointId(one, null))).toBe('point-gym');
	});

	it('is null when there is no point to pick (FR-MP-11)', () => {
		expect(lineDropOffPointId('point-med', [], null)).toBeNull();
	});
});

describe('dropOffPickerStyle', () => {
	it('uses buttons for up to three points and a dropdown for more', () => {
		expect(dropOffPickerStyle(2)).toBe('segmented');
		expect(dropOffPickerStyle(3)).toBe('segmented');
		expect(dropOffPickerStyle(4)).toBe('select');
	});
});

describe('currentDropOffPointIds / hasLinePoints', () => {
	it('lists only ticked points, not the main point', () => {
		expect([...currentDropOffPointIds(SHELTER)]).toEqual(['point-gym', 'point-med']);
		expect([...currentDropOffPointIds({ ...SHELTER, donation_points: [] })]).toEqual([]);
	});

	it('tells a split booking from one that names no point', () => {
		expect(hasLinePoints([{ drop_off_point_id: null }, {}])).toBe(false);
		expect(hasLinePoints([{}, { drop_off_point_id: 'point-gone' }])).toBe(true);
		expect(hasLinePoints(undefined)).toBe(false);
	});
});

describe('lineDestinationResolver (FR-MP-16)', () => {
	const resolve = lineDestinationResolver(SHELTER, ANY);

	it('resolves an offered point to that point', () => {
		expect(resolve('point-gym')).toMatchObject({
			pointId: 'point-gym',
			name: 'โรงยิม',
			note: 'ประตู 2',
			address: '1 ถ.เพชรเกษม'
		});
	});

	it('resolves no point, or one no longer offered, to the shelter address under "any point"', () => {
		for (const id of [null, 'point-gone']) {
			const point = resolve(id);
			expect(point).toMatchObject({ pointId: null, name: ANY, address: '1 ถ.เพชรเกษม' });
			expect(point.name).not.toContain('จุดหลัก');
		}
	});
});

describe('groupDropOffDestinations (FR-MP-13, FR-MP-16)', () => {
	const items = [
		{ drop_off_point_id: 'point-gym' },
		{ drop_off_point_id: 'point-med' },
		{ drop_off_point_id: 'point-gym' }
	];

	it('is null for a booking that names no point — it keeps the shelter as before', () => {
		expect(
			groupDropOffDestinations([{}, { drop_off_point_id: null }], SHELTER, { anyPointName: ANY })
		).toBeNull();
	});

	it('groups lines by point in the order of their first line, all waiting (AC-1)', () => {
		const groups = groupDropOffDestinations(items, SHELTER, { anyPointName: ANY })!;
		expect(groups.map((g) => [g.key, g.point.name, g.lineNos, g.status])).toEqual([
			['point-gym', 'โรงยิม', [0, 2], 'pending'],
			['point-med', 'ห้องพยาบาล', [1], 'pending']
		]);
	});

	it('marks a point received once every line of it has a receipt (AC-5)', () => {
		const groups = groupDropOffDestinations(items, SHELTER, {
			anyPointName: ANY,
			pointReceipts: [{ point_id: 'point-gym', line_nos: [0, 2] }]
		})!;
		expect(groups.map((g) => g.status)).toEqual(['received', 'pending']);
	});

	it('keeps a point waiting while only part of it is recorded', () => {
		const groups = groupDropOffDestinations(items, SHELTER, {
			anyPointName: ANY,
			pointReceipts: [{ point_id: 'point-gym', line_nos: [0] }]
		})!;
		expect(groups[0].status).toBe('pending');
	});

	it('counts a line recorded at another point (wrong point, FR-MP-21) as received', () => {
		const groups = groupDropOffDestinations(items, SHELTER, {
			anyPointName: ANY,
			pointReceipts: [{ point_id: 'point-gym', line_nos: [1] }]
		})!;
		expect(groups[1].status).toBe('received');
	});

	it('puts lines whose point is gone in one "any point" group (AC-13)', () => {
		const groups = groupDropOffDestinations(
			[{ drop_off_point_id: 'point-gym' }, { drop_off_point_id: 'point-gone' }, {}],
			SHELTER,
			{ anyPointName: ANY }
		)!;
		expect(groups.map((g) => [g.key, g.anyPoint, g.lineNos])).toEqual([
			['point-gym', false, [0]],
			[ANY_POINT_KEY, true, [1, 2]]
		]);
		expect(groups[1].point).toMatchObject({ name: ANY, address: '1 ถ.เพชรเกษม' });
	});

	it('says "received at the shelter" for lines recorded with no point left (AC-23)', () => {
		const unticked = { ...SHELTER, donation_points: [] };
		const groups = groupDropOffDestinations(items, unticked, {
			anyPointName: ANY,
			pointReceipts: [
				{ point_id: 'point-gym', line_nos: [0, 2] },
				{ point_id: null, line_nos: [1] }
			]
		})!;
		expect(groups.map((g) => [g.key, g.point.name, g.lineNos, g.status])).toEqual([
			[ANY_POINT_KEY, ANY, [0, 2], 'received'],
			[AT_SHELTER_KEY, SHELTER.name, [1], 'received_at_shelter']
		]);
	});

	it('leaves out a line refused at review — nothing of it is to be brought', () => {
		const groups = groupDropOffDestinations(
			[
				{ drop_off_point_id: 'point-gym' },
				{ drop_off_point_id: 'point-med', review_status: 'rejected' }
			],
			SHELTER,
			{ anyPointName: ANY }
		)!;
		expect(groups.map((g) => g.key)).toEqual(['point-gym']);
	});
});

describe('withCurrentLinePoints', () => {
	it('keeps offered points and clears the rest, so they share one label (FR-MP-14, FR-MP-16)', () => {
		expect(
			withCurrentLinePoints(
				[
					{ name: 'a', drop_off_point_id: 'point-gym' },
					{ name: 'b', drop_off_point_id: 'point-gone' },
					{ name: 'c' }
				],
				SHELTER
			)
		).toEqual([
			{ name: 'a', drop_off_point_id: 'point-gym' },
			{ name: 'b', drop_off_point_id: null },
			{ name: 'c', drop_off_point_id: null }
		]);
	});
});
