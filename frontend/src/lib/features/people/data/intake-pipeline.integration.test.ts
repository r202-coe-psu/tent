/**
 * End-to-end intake pipeline verification at the repository + queue-classifier seam
 * (Issue #209 / CR-106).
 *
 * Operating modes (aligned with approved CR-106 — not the superseded issue wording):
 * 1. Full 3-station: Registration → Medical Screening → Zoning check-in
 * 2. Flexible 2-desk medical: Registration → Medical screening with direct check-in (repo API)
 * 3. Screening disabled: Registration → Zoning check-in (no Station 2)
 */
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';
import { classifyScreeningQueueTab, classifyZoningQueueTab } from '../domain/intake-pipeline';
import type { EvacueeInput } from '../domain/people';

const mockShelterDb = 'shelter_sh001';
let memoryRepo = createInMemoryRepository();

vi.mock('$lib/db/shelter', () => ({
	getShelterCode: () => 'SH001',
	getShelterDb: () => mockShelterDb
}));

vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return {
		...actual,
		createRemoteRepository: () => memoryRepo
	};
});

import { PeopleRemoteRepository } from './people.remote';

const ctx = { shelterCode: 'SH001', createdBy: 'pipeline-tester' };

function evInput(over: Partial<EvacueeInput> = {}): EvacueeInput {
	return {
		first_name: 'Pipeline',
		last_name: 'Tester',
		gender: 'other',
		phone: '0890000001',
		status: 'arriving',
		...over
	};
}

describe('intake pipeline integration (#209)', () => {
	let repo: PeopleRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new PeopleRemoteRepository('shelter_sh001');
	});

	it('1. full 3-station: arriving → screening (still arriving) → zoning check_in → queues clear', async () => {
		const registered = await repo.createEvacuee(evInput({ special_needs: ['wheelchair'] }), ctx);
		expect(registered.current_stay.status).toBe('arriving');
		expect(registered.current_stay.zone).toBeNull();

		const screenedIdsEmpty = new Set<string>();
		expect(classifyScreeningQueueTab(registered, screenedIdsEmpty)).toBe('pending');
		expect(
			classifyZoningQueueTab(registered, {
				enableMedicalScreening: true,
				hasScreening: false
			})
		).toBeNull();

		const { screening, evacuee: afterScreen } = await repo.recordMedicalScreening(
			{
				screening: {
					evacuee_id: registered._id,
					track: 'normal',
					triage_level: 'yellow',
					symptoms: [],
					temperature_c: 37.1
				},
				checkIn: false
			},
			ctx
		);
		expect(screening.triage_level).toBe('yellow');
		expect(afterScreen).toBeUndefined();

		const mid = await repo.getEvacuee(registered._id);
		expect(mid?.current_stay.status).toBe('arriving');
		expect(mid?.current_stay.zone).toBeNull();

		const screenedIds = new Set([registered._id]);
		expect(classifyScreeningQueueTab(mid!, screenedIds)).toBe('screened');
		expect(
			classifyZoningQueueTab(mid!, {
				enableMedicalScreening: true,
				hasScreening: true
			})
		).toBe('pending');

		const checkedIn = await repo.checkInEvacuee(mid!, ctx, 'Zone-A');
		expect(checkedIn.current_stay.status).toBe('active');
		expect(checkedIn.current_stay.zone).toBe('Zone-A');

		const movements = await repo.listMovements();
		expect(
			movements.some(
				(m) => m.evacuee_id === registered._id && m.action === 'check_in' && m.zone === 'Zone-A'
			)
		).toBe(true);

		expect(classifyScreeningQueueTab(checkedIn, screenedIds)).toBeNull();
		expect(
			classifyZoningQueueTab(checkedIn, {
				enableMedicalScreening: true,
				hasScreening: true
			})
		).toBe('awaiting_confirm');
		expect(
			classifyZoningQueueTab(checkedIn, {
				enableMedicalScreening: true,
				hasScreening: true
			})
		).not.toBe('pending');
	});

	it('2. flexible medical direct check-in: registration → screening+zone (Station 2 repo path)', async () => {
		const registered = await repo.createEvacuee(evInput(), ctx);

		const result = await repo.recordMedicalScreening(
			{
				screening: {
					evacuee_id: registered._id,
					track: 'fast_track',
					triage_level: 'green',
					symptoms: [],
					temperature_c: 36.5
				},
				checkIn: true,
				zone: 'Zone-Direct'
			},
			ctx
		);

		expect(result.evacuee?.current_stay.status).toBe('active');
		expect(result.evacuee?.current_stay.zone).toBe('Zone-Direct');

		const screenedIds = new Set([registered._id]);
		expect(classifyScreeningQueueTab(result.evacuee!, screenedIds)).toBeNull();
		expect(
			classifyZoningQueueTab(result.evacuee!, {
				enableMedicalScreening: true,
				hasScreening: true
			})
		).toBe('awaiting_confirm');
	});

	it('3. screening disabled: registration → zoning check-in without screening doc', async () => {
		const registered = await repo.createEvacuee(evInput({ special_needs: ['infant'] }), ctx);

		expect(
			classifyZoningQueueTab(registered, {
				enableMedicalScreening: false,
				hasScreening: false
			})
		).toBe('pending');
		expect(classifyScreeningQueueTab(registered, new Set())).toBe('pending');

		const checkedIn = await repo.checkInEvacuee(registered, ctx, 'Zone-B');
		expect(checkedIn.current_stay.status).toBe('active');
		expect(checkedIn.current_stay.zone).toBe('Zone-B');

		expect(
			classifyZoningQueueTab(checkedIn, {
				enableMedicalScreening: false,
				hasScreening: false
			})
		).toBe('awaiting_confirm');
		expect(classifyScreeningQueueTab(checkedIn, new Set())).toBeNull();

		const screenings = await repo.listScreenings();
		expect(screenings.filter((s) => s.evacuee_id === registered._id)).toHaveLength(0);
	});
});
