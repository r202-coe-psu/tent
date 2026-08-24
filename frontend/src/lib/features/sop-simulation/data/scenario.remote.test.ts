// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SOP_RATIO_KEYS, SOP_RATIO_KIND, type SopRatioKey } from '$lib/features/sop-ratios';
import type { CalculationSnapshot } from '$lib/features/resource-calc';
import type { AuthorContext } from '$lib/db/model';

const { store, writes } = vi.hoisted(() => ({
	store: new Map<string, { _id: string; _rev?: string; type: string; [key: string]: unknown }>(),
	writes: [] as string[]
}));

vi.mock('$lib/db/shelter', () => ({ getShelterDb: () => 'shelter_sh001' }));
vi.mock('$lib/db/repository', () => ({
	createRemoteRepository: () => ({
		put: async (doc: { _id: string; _rev?: string; type: string }) => {
			writes.push(doc._id);
			const saved = { ...doc, _rev: '1-simulation' };
			store.set(doc._id, saved);
			return saved;
		},
		get: async (id: string) => store.get(id) ?? null,
		remove: vi.fn(),
		allByType: async (type: string, guard: (value: unknown) => boolean) =>
			[...store.values()].filter((doc) => doc.type === type && guard(doc)),
		pageByType: vi.fn(),
		find: vi.fn()
	})
}));

vi.mock('$lib/db/couch-db', () => ({
	couchDbFetch: async () => ({
		rows: [...store.values()]
			.filter((doc) => doc.type === 'simulation')
			.sort((left, right) => right._id.localeCompare(left._id))
			.map((doc) => ({ id: doc._id, doc }))
	})
}));

import { runSimulation } from '../application/use-run-simulation';
import { ScenarioRemoteRepository } from './scenario.remote';

const ratios = Object.fromEntries(SOP_RATIO_KEYS.map((key) => [key, '10'])) as Record<
	SopRatioKey,
	string
>;

const snapshot: CalculationSnapshot = {
	shelter_code: 'SH001',
	as_of: '2026-08-17T03:00:00.000Z',
	formula_v: '2.0.0',
	profile: {
		effective_id: 'sop_profile:master',
		effective_version: 3,
		ratio_source: 'master',
		base_profile_id: null,
		override_id: null,
		override_version: null
	},
	current_occupancy: 500,
	current_ratios: ratios,
	resource_inputs: SOP_RATIO_KEYS.map((key) => ({
		key,
		kind: SOP_RATIO_KIND[key],
		ratio: ratios[key],
		have: key.startsWith('max_') ? null : '1000'
	})),
	stock_snapshot: Object.fromEntries(
		SOP_RATIO_KEYS.map((key) => [key, key.startsWith('max_') ? null : '1000'])
	)
};

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'manager' };

beforeEach(() => {
	store.clear();
	writes.length = 0;
	store.set('daily_calc:2026-08-17', {
		_id: 'daily_calc:2026-08-17',
		_rev: '7-real',
		type: 'daily_calc',
		results: ['unchanged']
	});
});

describe('ScenarioRemoteRepository', () => {
	it('saves, lists, and opens an immutable snapshot without touching daily_calc', async () => {
		const before = structuredClone(store.get('daily_calc:2026-08-17'));
		const result = await runSimulation(
			{
				name: 'น้ำท่วมต่อเนื่อง 14 วัน',
				occupancy: 2000,
				days: 14,
				ratio_overrides: { water_l_per_person_day: '15' }
			},
			'SH001',
			async () => structuredClone(snapshot)
		);
		const repository = new ScenarioRemoteRepository('shelter_sh001');
		const saved = await repository.save(result, ctx);

		expect(saved._id).toMatch(/^simulation:[0-9A-HJKMNP-TV-Z]{26}$/);
		expect((await repository.listPage()).items).toEqual([
			expect.objectContaining({
				id: saved._id,
				name: 'น้ำท่วมต่อเนื่อง 14 วัน',
				override_count: 1
			})
		]);
		expect(await repository.get(saved._id)).toEqual(saved);
		expect((await repository.get(saved._id))?.result).toEqual(result);
		expect(writes).toEqual([saved._id]);
		expect(store.get('daily_calc:2026-08-17')).toEqual(before);
		expect(store.get('daily_calc:2026-08-17')?._rev).toBe('7-real');
		expect([...store.values()].filter((doc) => doc.type === 'audit')).toHaveLength(0);
	});

	it('rejects non-simulation ids on get', async () => {
		const repository = new ScenarioRemoteRepository('shelter_sh001');
		expect(await repository.get('daily_calc:2026-08-17')).toBeNull();
	});

	it('rejects saving a result under a different shelter context', async () => {
		const result = await runSimulation(
			{ name: 'cross shelter', occupancy: 10, days: 1, ratio_overrides: {} },
			'SH001',
			async () => structuredClone(snapshot)
		);
		const repository = new ScenarioRemoteRepository('shelter_sh002');
		await expect(
			repository.save(result, { shelterCode: 'SH002', createdBy: 'manager' })
		).rejects.toThrow('does not match');
		expect(writes).toHaveLength(0);
	});

	it('rejects a saved result whose projection or delta was tampered with', async () => {
		const result = await runSimulation(
			{ name: 'tampered', occupancy: 2000, days: 14, ratio_overrides: {} },
			'SH001',
			async () => structuredClone(snapshot)
		);
		const tampered = structuredClone(result);
		tampered.comparison[0]!.need_delta = '999999';
		const repository = new ScenarioRemoteRepository('shelter_sh001');

		await expect(repository.save(tampered, ctx)).rejects.toThrow(
			'Scenario projection is inconsistent'
		);
		expect(writes).toHaveLength(0);
	});

	it('returns a bounded newest-first page and a continuation cursor', async () => {
		const result = await runSimulation(
			{ name: 'paged scenario', occupancy: 10, days: 1, ratio_overrides: {} },
			'SH001',
			async () => structuredClone(snapshot)
		);
		const repository = new ScenarioRemoteRepository('shelter_sh001');
		await repository.save(result, ctx);
		await repository.save(result, ctx);
		await repository.save(result, ctx);
		const page = await repository.listPage(null, 2);
		expect(page.items).toHaveLength(2);
		expect(page.nextCursor).toBe(page.items[1]?.id);
		expect(page.items[0]!.id > page.items[1]!.id).toBe(true);
	});

	it('fails closed instead of silently dropping a malformed saved scenario', async () => {
		store.set('simulation:01K1ABCDEFGHJKMNPQRSTVWXYZ', {
			_id: 'simulation:01K1ABCDEFGHJKMNPQRSTVWXYZ',
			type: 'simulation',
			result: {}
		});
		const repository = new ScenarioRemoteRepository('shelter_sh001');
		await expect(repository.listPage()).rejects.toThrow();
	});
});
