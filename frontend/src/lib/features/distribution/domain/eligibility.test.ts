import { describe, expect, it } from 'vitest';
import {
	eligibilityInputSchema,
	eligibilitySnapshotSchema,
	evaluateDistributionEligibility
} from './eligibility';

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

describe('eligibilitySnapshotSchema cross-field invariants', () => {
	describe('VALID snapshots', () => {
		it('accepts valid consumable with or without previous receipt history', () => {
			expect(
				eligibilitySnapshotSchema.safeParse({
					distribution_type: 'consumable',
					had_previous_receipt: false,
					previous_receipt_count: 0,
					eligible: true,
					decision: 'consumable'
				}).success
			).toBe(true);

			expect(
				eligibilitySnapshotSchema.safeParse({
					distribution_type: 'consumable',
					had_previous_receipt: true,
					previous_receipt_count: 2,
					eligible: true,
					decision: 'consumable'
				}).success
			).toBe(true);
		});

		it('accepts valid first_receipt snapshot', () => {
			expect(
				eligibilitySnapshotSchema.safeParse({
					distribution_type: 'one_time',
					had_previous_receipt: false,
					previous_receipt_count: 0,
					eligible: true,
					decision: 'first_receipt'
				}).success
			).toBe(true);
		});

		it.each(['lost', 'damaged'] as const)(
			'accepts valid repeat_override snapshot with %s',
			(reason) => {
				expect(
					eligibilitySnapshotSchema.safeParse({
						distribution_type: 'one_time',
						had_previous_receipt: true,
						previous_receipt_count: 1,
						eligible: true,
						decision: 'repeat_override',
						repeat_override_reason: reason
					}).success
				).toBe(true);
			}
		);

		it('accepts valid repeat_rejected snapshot', () => {
			expect(
				eligibilitySnapshotSchema.safeParse({
					distribution_type: 'one_time',
					had_previous_receipt: true,
					previous_receipt_count: 2,
					eligible: false,
					decision: 'repeat_rejected'
				}).success
			).toBe(true);
		});
	});

	describe('INVALID snapshots', () => {
		it('rejects base history mismatch', () => {
			// count = 0 + had_previous = true
			expect(
				eligibilitySnapshotSchema.safeParse({
					distribution_type: 'one_time',
					had_previous_receipt: true,
					previous_receipt_count: 0,
					eligible: true,
					decision: 'first_receipt'
				}).success
			).toBe(false);

			// count > 0 + had_previous = false
			expect(
				eligibilitySnapshotSchema.safeParse({
					distribution_type: 'one_time',
					had_previous_receipt: false,
					previous_receipt_count: 1,
					eligible: true,
					decision: 'first_receipt'
				}).success
			).toBe(false);
		});

		it('rejects consumable contradictions', () => {
			// wrong distribution_type
			expect(
				eligibilitySnapshotSchema.safeParse({
					distribution_type: 'one_time',
					had_previous_receipt: false,
					previous_receipt_count: 0,
					eligible: true,
					decision: 'consumable'
				}).success
			).toBe(false);

			// eligible = false
			expect(
				eligibilitySnapshotSchema.safeParse({
					distribution_type: 'consumable',
					had_previous_receipt: false,
					previous_receipt_count: 0,
					eligible: false,
					decision: 'consumable'
				}).success
			).toBe(false);

			// override reason present
			expect(
				eligibilitySnapshotSchema.safeParse({
					distribution_type: 'consumable',
					had_previous_receipt: false,
					previous_receipt_count: 0,
					eligible: true,
					decision: 'consumable',
					repeat_override_reason: 'lost'
				}).success
			).toBe(false);
		});

		it('rejects first_receipt contradictions', () => {
			const base = {
				distribution_type: 'one_time' as const,
				had_previous_receipt: false,
				previous_receipt_count: 0,
				eligible: true,
				decision: 'first_receipt' as const
			};

			// had_previous = true and count > 0
			expect(
				eligibilitySnapshotSchema.safeParse({
					...base,
					had_previous_receipt: true,
					previous_receipt_count: 1
				}).success
			).toBe(false);

			// eligible = false
			expect(
				eligibilitySnapshotSchema.safeParse({
					...base,
					eligible: false
				}).success
			).toBe(false);

			// wrong distribution_type
			expect(
				eligibilitySnapshotSchema.safeParse({
					...base,
					distribution_type: 'consumable'
				}).success
			).toBe(false);

			// override reason present
			expect(
				eligibilitySnapshotSchema.safeParse({
					...base,
					repeat_override_reason: 'lost'
				}).success
			).toBe(false);
		});

		it('rejects repeat_override contradictions', () => {
			const base = {
				distribution_type: 'one_time' as const,
				had_previous_receipt: true,
				previous_receipt_count: 1,
				eligible: true,
				decision: 'repeat_override' as const,
				repeat_override_reason: 'lost' as const
			};

			// no previous receipt (count = 0, had_previous = false)
			expect(
				eligibilitySnapshotSchema.safeParse({
					...base,
					had_previous_receipt: false,
					previous_receipt_count: 0
				}).success
			).toBe(false);

			// eligible = false
			expect(
				eligibilitySnapshotSchema.safeParse({
					...base,
					eligible: false
				}).success
			).toBe(false);

			// wrong distribution_type
			expect(
				eligibilitySnapshotSchema.safeParse({
					...base,
					distribution_type: 'consumable'
				}).success
			).toBe(false);

			// missing override reason
			expect(
				eligibilitySnapshotSchema.safeParse({
					...base,
					repeat_override_reason: undefined
				}).success
			).toBe(false);
		});

		it('rejects repeat_rejected contradictions', () => {
			const base = {
				distribution_type: 'one_time' as const,
				had_previous_receipt: true,
				previous_receipt_count: 1,
				eligible: false,
				decision: 'repeat_rejected' as const
			};

			// no previous receipt (count = 0, had_previous = false)
			expect(
				eligibilitySnapshotSchema.safeParse({
					...base,
					had_previous_receipt: false,
					previous_receipt_count: 0
				}).success
			).toBe(false);

			// eligible = true
			expect(
				eligibilitySnapshotSchema.safeParse({
					...base,
					eligible: true
				}).success
			).toBe(false);

			// wrong distribution_type
			expect(
				eligibilitySnapshotSchema.safeParse({
					...base,
					distribution_type: 'consumable'
				}).success
			).toBe(false);

			// override reason present
			expect(
				eligibilitySnapshotSchema.safeParse({
					...base,
					repeat_override_reason: 'damaged'
				}).success
			).toBe(false);
		});
	});
});
