import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	assertUniqueRequirementGroupItemMaps,
	requirementGroupKeys,
	useSaveRequirementGroup
} from './requirement-group-queries';
import type { RequirementGroup } from '../domain/requirement-group';

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: { user: { name: 'sa', roles: ['system_admin'] } }
}));

vi.mock('svelte-sonner', () => ({
	toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('../data/requirement-group.remote', () => ({
	requirementGroupRepository: () => ({ save: vi.fn().mockResolvedValue({ ok: true }) })
}));

const mockInvalidateQueries = vi.fn();
vi.mock('@tanstack/svelte-query', () => ({
	createQuery: (fn: () => unknown) => fn(),
	useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
	createMutation: (fn: () => Record<string, unknown>) => fn()
}));

type SaveOptions = { onSuccess: () => unknown };

function group(
	id: string,
	itemIds: string[],
	source: RequirementGroup['source'] = 'SPHERE_BASELINE'
): RequirementGroup {
	return {
		_id: `requirement_group:${id}`,
		type: 'requirement_group',
		schema_v: 2,
		name: id,
		standard_uom: 'gram',
		status: 'active',
		item_maps: itemIds.map((item_id) => ({
			item_id,
			base_uom: 'g',
			conversion_factor: '1'
		})),
		source,
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z',
		created_by: 'tester'
	};
}

const input = (source: 'SPHERE_BASELINE' | 'SHELTER_OVERRIDE') => ({
	name: 'candidate',
	standard_uom: 'gram',
	status: 'active' as const,
	source,
	item_maps: [{ item_id: 'item_master:egg', base_uom: 'g', conversion_factor: '1' }]
});

describe('useSaveRequirementGroup', () => {
	beforeEach(() => mockInvalidateQueries.mockReset());

	it('hands back the list refetch so mutateAsync waits for it before the form closes', async () => {
		let refetched = false;
		mockInvalidateQueries.mockImplementation(async () => {
			await Promise.resolve();
			refetched = true;
		});
		const options = useSaveRequirementGroup() as unknown as SaveOptions;

		const result = options.onSuccess();

		expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: requirementGroupKeys.all });
		expect(result).toBeInstanceOf(Promise);
		await result;
		expect(refetched).toBe(true);
	});
});

describe('assertUniqueRequirementGroupItemMaps (#1282)', () => {
	it('checks override candidates against that shelter effective config', async () => {
		const repository = {
			listAll: vi.fn(),
			listAllStrict: vi.fn().mockResolvedValue([group('EXISTING', ['item_master:egg'])])
		};

		await expect(
			assertUniqueRequirementGroupItemMaps(
				'requirement_group:NEW',
				input('SHELTER_OVERRIDE'),
				'SH001',
				{
					repository: repository as never,
					listShelters: vi.fn()
				}
			)
		).rejects.toThrow('item_master:egg อยู่ในกลุ่ม "EXISTING" ของศูนย์ SH001');
		expect(repository.listAllStrict).toHaveBeenCalledWith('SH001');
	});

	it('checks baseline changes against every shelter effective config', async () => {
		const repository = {
			listAll: vi.fn().mockResolvedValue([]),
			listAllStrict: vi.fn().mockResolvedValue([group('EXISTING', ['item_master:egg'])])
		};

		await expect(
			assertUniqueRequirementGroupItemMaps(
				'requirement_group:NEW',
				input('SPHERE_BASELINE'),
				undefined,
				{
					repository: repository as never,
					listShelters: async () => [{ code: 'SH001' }, { code: 'SH002' }]
				}
			)
		).rejects.toThrow('item_master:egg อยู่ในกลุ่ม "EXISTING" ของศูนย์ SH001');
		expect(repository.listAllStrict).toHaveBeenCalledTimes(2);
	});

	it('ignores baseline candidates hidden by a same-ID shelter override', async () => {
		const repository = {
			listAll: vi.fn().mockResolvedValue([]),
			listAllStrict: vi
				.fn()
				.mockResolvedValue([
					group('NEW', ['item_master:rice'], 'SHELTER_OVERRIDE'),
					group('EXISTING', ['item_master:egg'])
				])
		};

		await expect(
			assertUniqueRequirementGroupItemMaps(
				'requirement_group:NEW',
				input('SPHERE_BASELINE'),
				undefined,
				{
					repository: repository as never,
					listShelters: async () => [{ code: 'SH001' }]
				}
			)
		).resolves.toBeUndefined();
	});

	it('fails closed if an effective shelter configuration cannot be read', async () => {
		const repository = {
			listAll: vi.fn().mockResolvedValue([]),
			listAllStrict: vi.fn().mockRejectedValue(new Error('forbidden'))
		};

		await expect(
			assertUniqueRequirementGroupItemMaps(
				'requirement_group:NEW',
				input('SPHERE_BASELINE'),
				undefined,
				{
					repository: repository as never,
					listShelters: async () => [{ code: 'SH001' }]
				}
			)
		).rejects.toThrow('forbidden');
	});
});
