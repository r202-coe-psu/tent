// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

import { PeopleRemoteRepository } from './people.remote';
import type { EvacueeInput } from '../domain/people';
import {
	STATION_LOG_STALE_WINDOW_MS,
	createStationLog,
	type StationLog
} from '../domain/station-log';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };

const isLog = (doc: unknown): doc is StationLog =>
	Boolean(doc && typeof doc === 'object' && (doc as { type?: string }).type === 'station_log');

async function logs(): Promise<StationLog[]> {
	return memoryRepo.allByType('station_log', isLog);
}

function evInput(over: Partial<EvacueeInput> = {}): EvacueeInput {
	return {
		first_name: 'Somchai',
		last_name: 'Jaidee',
		gender: 'male',
		phone: '0812345678',
		...over
	};
}

/** Make every `_bulk_docs` that carries a station_log fail, as if CouchDB rejected it. */
function failStationLogBulk(): void {
	const original = memoryRepo.bulkDocs.bind(memoryRepo);
	vi.spyOn(memoryRepo, 'bulkDocs').mockImplementation(async (docs) => {
		if ((docs as { type?: string }[]).some((d) => d.type === 'station_log')) {
			throw new Error('bulkDocs: 1 doc(s) failed');
		}
		return original(docs);
	});
}

describe('station_log writes (CR-192)', () => {
	let repo: PeopleRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new PeopleRemoteRepository('shelter_sh001');
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe('checkInEvacuee (Station 3 complete)', () => {
		it('writes a staff Station 3 complete for an arriving evacuee', async () => {
			const evacuee = await repo.createEvacuee(evInput({ status: 'arriving' }), ctx);

			await repo.checkInEvacuee(evacuee, ctx, 'zone-a');

			const written = await logs();
			expect(written).toHaveLength(1);
			expect(written[0]).toMatchObject({
				evacuee_id: evacuee._id,
				station: 3,
				action: 'complete',
				channel: 'staff',
				created_by: 'tester'
			});
			expect(written[0].device_id).toBeUndefined();
		});

		it('does not write a Station 3 log for a re-check-in that never passed zoning', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx); // pre_registered
			await repo.checkInEvacuee(evacuee, ctx, 'zone-a');
			expect(await logs()).toHaveLength(0);
		});

		it('still checks in and reports through onStationLogError when the log write fails', async () => {
			const evacuee = await repo.createEvacuee(evInput({ status: 'arriving' }), ctx);
			failStationLogBulk();
			const onStationLogError = vi.fn();

			const updated = await repo.checkInEvacuee(evacuee, ctx, 'zone-a', { onStationLogError });

			expect(updated.current_stay.status).toBe('active');
			expect(onStationLogError).toHaveBeenCalledTimes(1);
			expect(await logs()).toHaveLength(0);
		});
	});

	describe('recordMedicalScreening (Station 2 complete)', () => {
		it('writes a Station 2 complete', async () => {
			const evacuee = await repo.createEvacuee(evInput({ status: 'arriving' }), ctx);

			await repo.recordMedicalScreening(
				{ screening: { evacuee_id: evacuee._id, track: 'normal', symptoms: [] } },
				ctx
			);

			const written = await logs();
			expect(written).toHaveLength(1);
			expect(written[0]).toMatchObject({ station: 2, action: 'complete', channel: 'staff' });
		});

		it('writes Station 2 and Station 3 completes when it also checks in', async () => {
			const evacuee = await repo.createEvacuee(evInput({ status: 'arriving' }), ctx);

			await repo.recordMedicalScreening(
				{
					screening: { evacuee_id: evacuee._id, track: 'normal', symptoms: [] },
					checkIn: true,
					zone: 'zone-a'
				},
				ctx
			);

			expect((await logs()).map((l) => l.station).sort()).toEqual([2, 3]);
		});

		it('keeps the screening when the log write fails', async () => {
			const evacuee = await repo.createEvacuee(evInput({ status: 'arriving' }), ctx);
			failStationLogBulk();
			const onStationLogError = vi.fn();

			const result = await repo.recordMedicalScreening(
				{ screening: { evacuee_id: evacuee._id, track: 'normal', symptoms: [] } },
				ctx,
				{ onStationLogError }
			);

			expect(result.screening._id).toMatch(/^screening:/);
			expect(onStationLogError).toHaveBeenCalledTimes(1);
		});
	});

	describe('recordStationStart (idempotent staff start)', () => {
		const NOW = Date.parse('2026-10-25T05:00:00.000Z');

		beforeEach(() => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(NOW);
		});

		it('writes the first start and skips a reopen / refresh', async () => {
			expect(await repo.recordStationStart('evacuee:1', 2, ctx)).toBe(true);
			expect(await repo.recordStationStart('evacuee:1', 2, ctx)).toBe(false);

			const written = await logs();
			expect(written).toHaveLength(1);
			expect(written[0]).toMatchObject({
				evacuee_id: 'evacuee:1',
				station: 2,
				action: 'start',
				channel: 'staff'
			});
		});

		it('keeps starts of other stations and evacuees independent', async () => {
			await repo.recordStationStart('evacuee:1', 2, ctx);
			expect(await repo.recordStationStart('evacuee:1', 3, ctx)).toBe(true);
			expect(await repo.recordStationStart('evacuee:2', 2, ctx)).toBe(true);
		});

		it('writes a new start once the previous one was completed', async () => {
			await repo.recordStationStart('evacuee:1', 3, ctx);
			await memoryRepo.put(
				createStationLog(
					{ evacuee_id: 'evacuee:1', station: 3, action: 'complete', channel: 'staff' },
					ctx
				)
			);
			expect(await repo.recordStationStart('evacuee:1', 3, ctx)).toBe(true);
		});

		it('writes a new start when the previous one is older than the stale window', async () => {
			await memoryRepo.put(
				createStationLog(
					{
						evacuee_id: 'evacuee:1',
						station: 2,
						action: 'start',
						channel: 'staff',
						occurred_at: new Date(NOW - STATION_LOG_STALE_WINDOW_MS - 60_000).toISOString()
					},
					ctx
				)
			);
			expect(await repo.recordStationStart('evacuee:1', 2, ctx)).toBe(true);
			expect(await logs()).toHaveLength(2);
		});

		it('rejects when the write fails so the caller can warn', async () => {
			vi.spyOn(memoryRepo, 'put').mockRejectedValueOnce(new Error('Failed to fetch'));
			await expect(repo.recordStationStart('evacuee:1', 2, ctx)).rejects.toThrow('Failed to fetch');
		});
	});

	describe('Station 1 forms (start + complete per member)', () => {
		const familyInput = {
			members: [
				{
					first_name: 'สมชาย',
					last_name: 'ใจดี',
					gender: 'male' as const,
					phone: null,
					country: 'THAILAND'
				},
				{
					first_name: 'สมหญิง',
					last_name: 'ใจดี',
					gender: 'female' as const,
					phone: null,
					country: 'THAILAND'
				}
			],
			household: {
				housing_type: 'owned_house' as const,
				address_no: '12/3',
				subdistrict: 'หาดใหญ่',
				district: 'หาดใหญ่',
				province: 'สงขลา',
				pets: [],
				vehicles: [],
				assets: null
			}
		};

		it('writes start (form-open time) and complete for every created member', async () => {
			const openedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();

			const { members } = await repo.createFamilyRegistration(
				familyInput,
				ctx,
				'onsite',
				undefined,
				null,
				{ startedAt: openedAt }
			);

			const written = await logs();
			expect(written).toHaveLength(4);
			for (const m of members) {
				const mine = written.filter((l) => l.evacuee_id === m._id);
				const start = mine.find((l) => l.action === 'start');
				const complete = mine.find((l) => l.action === 'complete');
				expect(start).toMatchObject({ station: 1, channel: 'staff', occurred_at: openedAt });
				expect(complete).toMatchObject({ station: 1, channel: 'staff' });
				expect(Date.parse(complete!.occurred_at)).toBeGreaterThanOrEqual(Date.parse(openedAt));
			}
		});

		it('never stamps a start in the future', async () => {
			const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
			await repo.createFamilyRegistration(familyInput, ctx, 'onsite', undefined, null, {
				startedAt: future
			});
			for (const l of await logs()) {
				expect(Date.parse(l.occurred_at)).toBeLessThanOrEqual(Date.now());
			}
		});

		it('writes nothing without startedAt (e.g. pre-registration)', async () => {
			await repo.createFamilyRegistration(familyInput, ctx, 'onsite');
			expect(await logs()).toHaveLength(0);
		});

		it('keeps the registration and reports when the log write fails', async () => {
			failStationLogBulk();
			const onStationLogError = vi.fn();

			const { members } = await repo.createFamilyRegistration(
				familyInput,
				ctx,
				'onsite',
				undefined,
				null,
				{ startedAt: new Date().toISOString(), onStationLogError }
			);

			expect(members).toHaveLength(2);
			expect(onStationLogError).toHaveBeenCalledTimes(1);
			expect(await logs()).toHaveLength(0);
		});

		it('writes start + complete only for members reported in by submitFamilyReportIn', async () => {
			const a = await repo.createEvacuee(evInput({ first_name: 'A' }), ctx);
			const b = await repo.createEvacuee(evInput({ first_name: 'B' }), ctx);
			const household = await repo.createHousehold(
				{ label: 'ครัวเรือนทดสอบ', head_evacuee_id: a._id, status: 'pre_registered' },
				ctx
			);
			await repo.updateEvacuee({ ...a, household_id: household._id });
			await repo.updateEvacuee({ ...b, household_id: household._id });
			const openedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();

			const result = await repo.submitFamilyReportIn(
				{
					householdId: household._id,
					household: familyInput.household,
					members: [
						{ ...familyInput.members[0], _id: a._id, reporting_in: true },
						{ ...familyInput.members[1], _id: b._id, reporting_in: false }
					],
					ctx
				},
				{ startedAt: openedAt }
			);

			expect(result.members.map((m) => m._id)).toEqual([a._id]);
			const written = await logs();
			expect(written).toHaveLength(2);
			expect(written.every((l) => l.evacuee_id === a._id && l.station === 1)).toBe(true);
			expect(written.find((l) => l.action === 'start')?.occurred_at).toBe(openedAt);
		});
	});
});
