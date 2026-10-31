// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import DropOffGroups from './drop-off-groups.svelte';
import { groupDropOffDestinations } from '../domain/line-points';
import type { DropOffShelterSource } from '../domain/drop-off';

const ANY = 'ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้';
const AWAITING = 'รอเจ้าหน้าที่กำหนดจุดส่ง';
const SHELTER: DropOffShelterSource = {
	code: 'SH001',
	name: 'ศูนย์พักพิงหาดใหญ่',
	address: '1 ถ.เพชรเกษม',
	geo: { lat: 7.0086, lng: 100.4747 },
	donation_points: [
		{
			id: 'point-gym',
			name: 'โรงยิม',
			geo: { lat: 7.009, lng: 100.4752 },
			location_note: 'ประตู 2'
		},
		{ id: 'point-med', name: 'ห้องพยาบาล', geo: { lat: 7.01, lng: 100.476 } }
	]
};
const NAMES = ['น้ำดื่ม', 'ยา', 'ผ้าห่ม'];

let instance: ReturnType<typeof mount> | null = null;

function render(
	pointReceipts: { point_id: string | null; line_nos: number[] }[],
	props: { showPending?: boolean; showReceived?: boolean; directions?: boolean } = {}
) {
	const groups = groupDropOffDestinations(
		[
			{ drop_off_point_id: 'point-gym' },
			{ drop_off_point_id: 'point-med' },
			{ drop_off_point_id: 'point-gone' }
		],
		SHELTER,
		{ anyPointName: ANY, awaitingName: AWAITING, deliveryMethod: 'self_dropoff', pointReceipts }
	)!;
	instance = mount(DropOffGroups, {
		target: document.body,
		props: { groups, lineNames: NAMES, ...props }
	});
	flushSync();
}

const cards = () => [...document.body.querySelectorAll('[data-testid="drop-off-group"]')];
const statusOf = (card: Element) =>
	card.querySelector('[data-testid="drop-off-group-status"]')?.textContent?.trim() ?? null;

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('DropOffGroups (CR-206 FR-MP-13, FR-MP-16)', () => {
	it('shows one card per point with its goods, "received" and "awaiting" (AC-5)', () => {
		render([{ point_id: 'point-gym', line_nos: [0] }]);

		const [gym, med, any] = cards();
		expect(gym.textContent).toContain('โรงยิม');
		expect(gym.textContent).toContain('ประตู 2');
		expect(gym.textContent).toContain('น้ำดื่ม');
		expect(statusOf(gym)).toBe('รับแล้ว');
		expect(statusOf(med)).toBe('รอรับ');
		expect(any.getAttribute('data-point-id')).toBe('*');
	});

	it('puts a line whose point is gone under "any point" with the shelter address, never "จุดหลัก" (AC-13)', () => {
		render([]);

		const any = cards()[2];
		expect(any.textContent).toContain(ANY);
		expect(any.textContent).toContain('1 ถ.เพชรเกษม');
		expect(any.textContent).toContain('ผ้าห่ม');
		expect(document.body.textContent).not.toContain('จุดหลัก');
	});

	it('says "received at the shelter" for lines recorded with no point left (AC-23)', () => {
		render([{ point_id: null, line_nos: [2] }]);
		expect(statusOf(cards()[2])).toBe('รับแล้วที่ศูนย์');
	});

	it('gives each point its own directions link, and none when directions are off', () => {
		render([]);
		expect(document.body.querySelectorAll('a[target="_blank"]')).toHaveLength(3);
		unmount(instance!);
		instance = null;
		document.body.innerHTML = '';

		render([], { directions: false });
		expect(document.body.querySelectorAll('a')).toHaveLength(0);
	});

	it('hides "awaiting" once the booking is closed', () => {
		render([{ point_id: 'point-gym', line_nos: [0] }], { showPending: false });
		expect(cards().map(statusOf)).toEqual(['รับแล้ว', null, null]);
	});
	// Staff-assigned drop-off FR-AP-22 — the lines staff have yet to give a point.
	it('shows the awaiting-staff card last, with its note, the shelter address and no status (AC-13)', () => {
		const groups = groupDropOffDestinations(
			[
				{ drop_off_point_id: null, review_status: 'pending' },
				{ drop_off_point_id: 'point-gym', review_status: 'approved' }
			],
			SHELTER,
			{ anyPointName: ANY, awaitingName: AWAITING, deliveryMethod: 'self_dropoff' }
		)!;
		instance = mount(DropOffGroups, {
			target: document.body,
			props: { groups, lineNames: ['ผ้าห่ม', 'ข้าวสาร'] }
		});
		flushSync();

		const [gym, awaiting] = cards();
		expect(gym.textContent).toContain('ข้าวสาร');
		expect(awaiting.textContent).toContain(AWAITING);
		expect(awaiting.textContent).toContain('ผ้าห่ม');
		expect(awaiting.textContent).toContain('1 ถ.เพชรเกษม');
		expect(
			awaiting.querySelector('[data-testid="drop-off-group-awaiting-note"]')?.textContent
		).toContain('ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้');
		expect(statusOf(awaiting)).toBeNull();
		expect(statusOf(gym)).toBe('รอรับ');
	});
});
