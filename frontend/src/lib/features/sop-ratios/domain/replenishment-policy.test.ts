import { describe, expect, it } from 'vitest';
import {
	findItemPolicy,
	itemPolicyTargetId,
	replenishmentPolicyDocId,
	replenishmentPolicyInputSchema,
	type ReplenishmentPolicy
} from './replenishment-policy';
import { DEFAULT_REPLENISHMENT_POLICIES } from './replenishment-policy.fixture';

const itemPolicy = (target_id: string, status: 'active' | 'inactive' = 'active') =>
	({
		...DEFAULT_REPLENISHMENT_POLICIES[0],
		_id: `replenishment_policy:ITEM:${target_id}`,
		scope_type: 'ITEM',
		target_id,
		status
	}) satisfies ReplenishmentPolicy;

describe('itemPolicyTargetId', () => {
	it('strips the item_master prefix and keeps the case', () => {
		expect(itemPolicyTargetId('item_master:Rice-5kg')).toBe('Rice-5kg');
		expect(itemPolicyTargetId('Rice-5kg')).toBe('Rice-5kg');
	});
});

describe('replenishmentPolicyDocId', () => {
	it('builds the scoped doc id', () => {
		expect(replenishmentPolicyDocId('ITEM', 'Rice-5kg')).toBe('replenishment_policy:ITEM:Rice-5kg');
	});
});

describe('findItemPolicy', () => {
	it('finds a policy stored under the clean id', () => {
		const p = itemPolicy('rice');
		expect(findItemPolicy('item_master:rice', [p])).toBe(p);
	});

	it('finds a policy stored under the prefixed id', () => {
		const p = itemPolicy('item_master:rice');
		expect(findItemPolicy('item_master:rice', [p])).toBe(p);
	});

	it('returns inactive policies so they can be re-enabled', () => {
		const p = itemPolicy('rice', 'inactive');
		expect(findItemPolicy('item_master:rice', [p])).toBe(p);
	});

	it('ignores other scopes and other items', () => {
		expect(
			findItemPolicy('item_master:rice', [...DEFAULT_REPLENISHMENT_POLICIES, itemPolicy('oil')])
		).toBeNull();
	});
});

describe('replenishmentPolicyInputSchema for an ITEM policy', () => {
	const base = {
		scope_type: 'ITEM',
		target_id: 'rice',
		lead_time_days: 2,
		review_period_days: 3,
		safety_days: 2,
		min_doc_days: 2,
		max_doc_days: 30
	};

	it('accepts valid days', () => {
		expect(replenishmentPolicyInputSchema.safeParse(base).success).toBe(true);
	});

	it('rejects min DoC at or above the standard reorder days', () => {
		expect(replenishmentPolicyInputSchema.safeParse({ ...base, min_doc_days: 7 }).success).toBe(
			false
		);
	});

	it('rejects max DoC at or below min DoC', () => {
		expect(replenishmentPolicyInputSchema.safeParse({ ...base, max_doc_days: 2 }).success).toBe(
			false
		);
	});
});
