import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requirementGroupKeys, useSaveRequirementGroup } from './requirement-group-queries';

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
