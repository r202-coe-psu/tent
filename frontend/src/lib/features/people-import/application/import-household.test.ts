// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';

let memoryRepo = createInMemoryRepository();

vi.mock('$lib/db/shelter', () => ({
	getShelterCode: () => 'SH001',
	getShelterDb: () => 'shelter_sh001'
}));

vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: () => memoryRepo };
});

import { peopleRepository } from '$lib/features/people';
import { H } from '../domain/columns';
import { validateRow, type RawRow } from '../domain/import-row';
import { importHousehold, PartialHouseholdImportError } from './import-household';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };
const NOW = new Date('2026-11-15T05:00:00.000Z');
const lookups = { now: NOW, zones: [{ code: 'A', name: 'โซน A', status: 'active' }] };

function person(first: string, overrides: RawRow = {}): RawRow {
	return {
		[H.first_name]: first,
		[H.last_name]: 'ใจดี',
		[H.gender]: 'ชาย',
		[H.stay_status]: 'พักอยู่',
		[H.arrived_at]: '10/11/2569 14:00',
		[H.zone]: 'โซน A',
		...overrides
	};
}
const left = (first: string): RawRow =>
	person(first, { [H.stay_status]: 'กลับแล้ว', [H.departed_at]: '12/11/2569 09:30' });

function payloadOf(head: RawRow, members: RawRow[] = []) {
	const result = validateRow(
		head,
		1,
		lookups,
		members.map((cells, i) => ({ ref: '1', line: i + 1, cells }))
	);
	expect(result.errors).toEqual([]);
	return result.payload!;
}

describe('importHousehold (Backfill Import write sequence)', () => {
	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
	});

	it('writes people with back-dated movements and a household derived from their stays', async () => {
		const repo = peopleRepository();
		const out = await importHousehold(
			repo,
			payloadOf(person('สมชาย'), [left('สมหญิง')]),
			new Set(),
			ctx
		);

		expect(out).toMatchObject({ createdPeople: 2, createdMembers: 1 });
		const members = await repo.listHouseholdMembers(out.householdId);
		const byName = Object.fromEntries(members.map((m) => [m.first_name, m]));
		expect(byName['สมชาย'].current_stay).toMatchObject({
			status: 'active',
			zone: 'A',
			since: '2026-11-10T07:00:00.000Z'
		});
		expect(byName['สมหญิง'].current_stay).toMatchObject({
			status: 'checked_out',
			zone: null,
			since: '2026-11-12T02:30:00.000Z'
		});

		const movements = await repo.listMovementsByEvacuee(byName['สมหญิง']._id);
		expect(movements.map((m) => m.action).sort()).toEqual(['check_in', 'check_out']);

		const household = await repo.getHousehold(out.householdId);
		expect(household?.status).toBe('checked_in');
		expect(household?.head_evacuee_id).toBe(byName['สมชาย']._id);
	});

	it('keeps the returned_home preset and checked_out status when everyone has left', async () => {
		const repo = peopleRepository();
		const out = await importHousehold(repo, payloadOf(left('สมชาย')), new Set(), ctx);

		const household = await repo.getHousehold(out.householdId);
		expect(household?.status).toBe('checked_out');
		expect(household?.checkout_destination).toEqual({ type: 'returned_home' });
	});

	it('leaves out members already registered (skipped lines)', async () => {
		const repo = peopleRepository();
		const out = await importHousehold(
			repo,
			payloadOf(person('สมชาย'), [person('ก'), person('ข')]),
			new Set([1]),
			ctx
		);

		expect(out.createdMembers).toBe(1);
		const names = (await repo.listHouseholdMembers(out.householdId)).map((m) => m.first_name);
		expect(names.sort()).toEqual(['ข', 'สมชาย'].sort());
	});

	it('reports the half-written household when the stay write fails', async () => {
		const repo = peopleRepository();
		vi.spyOn(repo, 'applyBackfilledStays').mockRejectedValueOnce(new Error('network down'));

		const err = await importHousehold(repo, payloadOf(person('สมชาย')), new Set(), ctx).catch(
			(e: unknown) => e
		);

		expect(err).toBeInstanceOf(PartialHouseholdImportError);
		const partial = err as PartialHouseholdImportError;
		expect(partial.message).toContain('network down');
		expect(partial.message).toContain(partial.householdId);
		// The household really is left behind, still pre_registered — which is why the id is surfaced.
		const members = await repo.listHouseholdMembers(partial.householdId);
		expect(members[0].current_stay.status).toBe('pre_registered');
	});
});
