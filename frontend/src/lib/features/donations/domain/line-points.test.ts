import { describe, expect, it } from 'vitest';
import {
	ANY_POINT_KEY,
	AT_SHELTER_KEY,
	AWAITING_STAFF_KEY,
	currentDropOffPointIds,
	groupDropOffDestinations,
	hasLinePoints,
	lineDestinationResolver,
	withCampaignLinePoints,
	withCurrentLinePoints
} from './line-points';
import type { DropOffShelterSource } from './drop-off';

const ANY = 'ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้';
const AWAITING = 'รอเจ้าหน้าที่กำหนดจุดส่ง';
const OPTS = { anyPointName: ANY, awaitingName: AWAITING, deliveryMethod: 'self_dropoff' };

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
		expect(groupDropOffDestinations([{}, { drop_off_point_id: null }], SHELTER, OPTS)).toBeNull();
	});

	it('groups lines by point in the order of their first line, all waiting (AC-1)', () => {
		const groups = groupDropOffDestinations(items, SHELTER, OPTS)!;
		expect(groups.map((g) => [g.key, g.point.name, g.lineNos, g.status])).toEqual([
			['point-gym', 'โรงยิม', [0, 2], 'pending'],
			['point-med', 'ห้องพยาบาล', [1], 'pending']
		]);
	});

	it('marks a point received once every line of it has a receipt (AC-5)', () => {
		const groups = groupDropOffDestinations(items, SHELTER, {
			...OPTS,
			pointReceipts: [{ point_id: 'point-gym', line_nos: [0, 2] }]
		})!;
		expect(groups.map((g) => g.status)).toEqual(['received', 'pending']);
	});

	it('keeps a point waiting while only part of it is recorded', () => {
		const groups = groupDropOffDestinations(items, SHELTER, {
			...OPTS,
			pointReceipts: [{ point_id: 'point-gym', line_nos: [0] }]
		})!;
		expect(groups[0].status).toBe('pending');
	});

	it('counts a line recorded at another point (wrong point, FR-MP-21) as received', () => {
		const groups = groupDropOffDestinations(items, SHELTER, {
			...OPTS,
			pointReceipts: [{ point_id: 'point-gym', line_nos: [1] }]
		})!;
		expect(groups[1].status).toBe('received');
	});

	it('puts lines whose point is gone in one "any point" group (AC-13)', () => {
		const groups = groupDropOffDestinations(
			[{ drop_off_point_id: 'point-gym' }, { drop_off_point_id: 'point-gone' }, {}],
			SHELTER,
			OPTS
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
			...OPTS,
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
			OPTS
		)!;
		expect(groups.map((g) => g.key)).toEqual(['point-gym']);
	});
});

describe('groupDropOffDestinations — lines awaiting staff (staff-assigned drop-off FR-AP-22)', () => {
	const rice = { drop_off_point_id: 'point-gym', review_status: 'approved' };
	const blanket = { drop_off_point_id: null, review_status: 'pending' };
	const view = (groups: ReturnType<typeof groupDropOffDestinations>) =>
		groups?.map((g) => [g.key, g.point.name, g.lineNos, g.status, g.anyPoint]) ?? null;

	it('puts a typed-in line in an "awaiting staff" group after the campaign point (AC-AP-13)', () => {
		expect(view(groupDropOffDestinations([rice, blanket], SHELTER, OPTS))).toEqual([
			['point-gym', 'โรงยิม', [0], 'pending', false],
			[AWAITING_STAFF_KEY, AWAITING, [1], 'pending', true]
		]);
	});

	it('shows the awaiting group last even when its line comes first', () => {
		expect(
			groupDropOffDestinations([blanket, rice], SHELTER, OPTS)!.map((g) => [g.key, g.lineNos])
		).toEqual([
			['point-gym', [1]],
			[AWAITING_STAFF_KEY, [0]]
		]);
	});

	it('groups a booking with no point at all when its lines await staff (AC-AP-9)', () => {
		const groups = groupDropOffDestinations([blanket, blanket], SHELTER, OPTS)!;
		expect(view(groups)).toEqual([[AWAITING_STAFF_KEY, AWAITING, [0, 1], 'pending', true]]);
		expect(groups[0].point).toMatchObject({ address: '1 ถ.เพชรเกษม', pointId: null });
	});

	it('has no awaiting group for a parcel (AC-AP-9)', () => {
		expect(
			groupDropOffDestinations([blanket, blanket], SHELTER, { ...OPTS, deliveryMethod: 'parcel' })
		).toBeNull();
	});

	it('has no awaiting group at a shelter with no point', () => {
		const noPoints = { ...SHELTER, donation_points: [] };
		expect(groupDropOffDestinations([blanket], noPoints, OPTS)).toBeNull();
	});

	it('keeps a pending line that has a point in that point group (FR-AP-22b, AC-AP-13a)', () => {
		const notSeeded = { drop_off_point_id: 'point-gym', review_status: 'pending' };
		expect(view(groupDropOffDestinations([notSeeded], SHELTER, OPTS))).toEqual([
			['point-gym', 'โรงยิม', [0], 'pending', false]
		]);
	});

	it('puts a pending line whose point is gone in the awaiting group (AC-AP-13a)', () => {
		const gone = { drop_off_point_id: 'point-gone', review_status: 'pending' };
		expect(groupDropOffDestinations([gone], SHELTER, OPTS)!.map((g) => g.key)).toEqual([
			AWAITING_STAFF_KEY
		]);
	});

	it('keeps an approved line whose point is gone in the "any point" group (AC-AP-6, AC-AP-7)', () => {
		const gone = { drop_off_point_id: 'point-gone', review_status: 'approved' };
		expect(groupDropOffDestinations([gone, blanket], SHELTER, OPTS)!.map((g) => g.key)).toEqual([
			ANY_POINT_KEY,
			AWAITING_STAFF_KEY
		]);
	});

	it('leaves a line a point already recorded out of the awaiting group (AC-AP-13b)', () => {
		const groups = groupDropOffDestinations([rice, blanket], SHELTER, {
			...OPTS,
			pointReceipts: [{ point_id: 'point-gym', line_nos: [1] }]
		})!;
		expect(groups.map((g) => [g.key, g.lineNos, g.status])).toEqual([
			['point-gym', [0], 'pending'],
			[ANY_POINT_KEY, [1], 'received']
		]);
	});

	it('leaves a line recorded with no point in the "received at the shelter" group', () => {
		const groups = groupDropOffDestinations([rice, blanket], SHELTER, {
			...OPTS,
			pointReceipts: [{ point_id: null, line_nos: [1] }]
		})!;
		expect(groups.map((g) => [g.key, g.status])).toEqual([
			['point-gym', 'pending'],
			[AT_SHELTER_KEY, 'received_at_shelter']
		]);
	});

	it('leaves a line refused at review out', () => {
		const refused = { drop_off_point_id: null, review_status: 'rejected' };
		expect(groupDropOffDestinations([rice, refused], SHELTER, OPTS)!.map((g) => g.key)).toEqual([
			'point-gym'
		]);
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

describe('withCampaignLinePoints (staff-assigned drop-off FR-AP-8, FR-AP-9)', () => {
	const rice = { item_id: 'item:rice', free_text: 'ข้าว' };
	const blanket: { item_id?: string; free_text: string } = { free_text: 'ผ้าห่ม' };
	const campaign = (pointId: string | null | undefined) => ({
		needs: [
			{ item_id: 'item:rice', ...(pointId !== undefined ? { drop_off_point_id: pointId } : {}) }
		]
	});
	const points = (lines: { drop_off_point_id: string | null }[]) =>
		lines.map((line) => line.drop_off_point_id);

	it('gives a campaign line its need point and a typed-in line none (AC-AP-13)', () => {
		expect(
			points(withCampaignLinePoints([rice, blanket], campaign('point-gym'), 'self_dropoff'))
		).toEqual(['point-gym', null]);
	});

	it('reads the need of the campaign picked for the booking, not another one (AC-AP-4)', () => {
		const campaignB = campaign('point-med');
		expect(points(withCampaignLinePoints([rice], campaignB, 'self_dropoff'))).toEqual([
			'point-med'
		]);
	});

	it('uses the first need that asks for the item', () => {
		const twice = {
			needs: [
				{ item_id: 'item:rice', drop_off_point_id: 'point-gym' },
				{ item_id: 'item:rice', drop_off_point_id: 'point-med' }
			]
		};
		expect(points(withCampaignLinePoints([rice], twice, 'self_dropoff'))).toEqual(['point-gym']);
	});

	it('copies a point the shelter may have dropped since, unchecked (D-AP-5, AC-AP-6)', () => {
		expect(points(withCampaignLinePoints([rice], campaign('point-gone'), 'self_dropoff'))).toEqual([
			'point-gone'
		]);
	});

	it('writes null for a need with no point, or a v3 need with no key (AC-AP-16)', () => {
		expect(points(withCampaignLinePoints([rice], campaign(null), 'self_dropoff'))).toEqual([null]);
		expect(points(withCampaignLinePoints([rice], campaign(undefined), 'self_dropoff'))).toEqual([
			null
		]);
	});

	it('writes null for every line of a booking with no campaign (AC-AP-9)', () => {
		expect(points(withCampaignLinePoints([rice, blanket], null, 'self_dropoff'))).toEqual([
			null,
			null
		]);
	});

	it('writes null for every line of a parcel or a pickup (AC-AP-8)', () => {
		for (const method of ['parcel', 'shelter_pickup', undefined]) {
			expect(points(withCampaignLinePoints([rice], campaign('point-gym'), method))).toEqual([null]);
		}
	});

	it('overwrites whatever point the client sent, keeping the rest of the line (AC-AP-5)', () => {
		const sent = { ...blanket, qty: '2', drop_off_point_id: 'point-med' };
		expect(withCampaignLinePoints([sent], campaign('point-gym'), 'self_dropoff')).toEqual([
			{ free_text: 'ผ้าห่ม', qty: '2', drop_off_point_id: null }
		]);
	});
});
