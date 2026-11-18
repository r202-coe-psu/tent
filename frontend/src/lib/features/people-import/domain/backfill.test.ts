import { describe, expect, it } from 'vitest';
import { createEvacuee, BACKFILL_IMPORT_REASON } from '$lib/features/people';
import { buildBackfilledStay } from './backfill';
import type { ImportStay } from './import-row';

const ctx = { shelterCode: 'TEST', createdBy: 'tester' };

function evacuee() {
	return createEvacuee(
		{
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			phone: null,
			registered_via: 'import'
		},
		ctx,
		null
	);
}

const ARRIVED = '2026-11-10T07:00:00.000Z';
const DEPARTED = '2026-11-12T02:30:00.000Z';

describe('buildBackfilledStay', () => {
	it('active: one back-dated check_in in the zone, stay active since the arrival', () => {
		const stay: ImportStay = { status: 'active', arrivedAt: ARRIVED, departedAt: null, zone: 'A' };
		const { evacuee: next, movements } = buildBackfilledStay(evacuee(), stay, ctx);

		expect(movements).toHaveLength(1);
		expect(movements[0]).toMatchObject({
			action: 'check_in',
			zone: 'A',
			occurred_at: ARRIVED,
			evacuee_id: next._id
		});
		expect(next.current_stay).toEqual({ status: 'active', zone: 'A', since: ARRIVED });
	});

	it('checked_out: check_in then check_out(backfill_import, no destination), since = departure', () => {
		const stay: ImportStay = {
			status: 'checked_out',
			arrivedAt: ARRIVED,
			departedAt: DEPARTED,
			zone: 'A'
		};
		const { evacuee: next, movements } = buildBackfilledStay(evacuee(), stay, ctx);

		expect(movements.map((m) => m.action)).toEqual(['check_in', 'check_out']);
		expect(movements[0]).toMatchObject({ zone: 'A', occurred_at: ARRIVED });
		expect(movements[1]).toMatchObject({
			zone: null,
			occurred_at: DEPARTED,
			reason: BACKFILL_IMPORT_REASON
		});
		expect(movements[1].destination).toBeUndefined();
		expect(next.current_stay).toEqual({ status: 'checked_out', zone: null, since: DEPARTED });
	});

	it('checked_out with no known zone still writes the check_in (zone null)', () => {
		const stay: ImportStay = {
			status: 'checked_out',
			arrivedAt: ARRIVED,
			departedAt: DEPARTED,
			zone: null
		};
		const { movements } = buildBackfilledStay(evacuee(), stay, ctx);

		expect(movements[0].action).toBe('check_in');
		expect(movements[0].zone).toBeNull();
	});

	it('does not mutate the evacuee it was given', () => {
		const original = evacuee();
		const before = structuredClone(original.current_stay);
		buildBackfilledStay(
			original,
			{ status: 'active', arrivedAt: ARRIVED, departedAt: null, zone: 'A' },
			ctx
		);
		expect(original.current_stay).toEqual(before);
	});
});
