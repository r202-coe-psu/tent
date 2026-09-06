import { describe, expect, it } from 'vitest';
import { eligibilityInputSchema, evaluateDistributionEligibility } from './eligibility';

const previous = [{ issue_id: 'distribution_issue:OLD', distributed_at: '2026-08-01T00:00:00Z' }];

describe('evaluateDistributionEligibility', () => {
	it('allows consumables regardless of previous receipts', () => {
		expect(
			evaluateDistributionEligibility({
				distribution_type: 'consumable',
				previous_receipts: previous
			})
		).toMatchObject({ eligible: true, decision: 'consumable', had_previous_receipt: true });
	});

	it('allows the first one-time receipt', () => {
		expect(
			evaluateDistributionEligibility({
				distribution_type: 'one_time',
				previous_receipts: []
			})
		).toEqual({
			distribution_type: 'one_time',
			had_previous_receipt: false,
			previous_receipt_count: 0,
			eligible: true,
			decision: 'first_receipt'
		});
	});

	it('rejects a repeated one-time receipt without an override', () => {
		expect(
			evaluateDistributionEligibility({
				distribution_type: 'one_time',
				previous_receipts: previous
			})
		).toMatchObject({ eligible: false, decision: 'repeat_rejected' });
	});

	it.each(['lost', 'damaged'] as const)('allows a repeated one-time receipt for %s', (reason) => {
		expect(
			evaluateDistributionEligibility({
				distribution_type: 'one_time',
				previous_receipts: previous,
				repeat_override_reason: reason
			})
		).toMatchObject({
			eligible: true,
			decision: 'repeat_override',
			repeat_override_reason: reason
		});
	});

	it('rejects an unsupported override reason at the schema boundary', () => {
		expect(
			eligibilityInputSchema.safeParse({
				distribution_type: 'one_time',
				previous_receipts: previous,
				repeat_override_reason: 'other'
			}).success
		).toBe(false);
	});
});
