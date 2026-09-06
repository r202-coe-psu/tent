import { z } from 'zod';

export const distributionTypeSnapshotSchema = z.enum(['consumable', 'one_time']);
export type DistributionTypeSnapshot = z.infer<typeof distributionTypeSnapshotSchema>;

export const repeatOverrideReasonSchema = z.enum(['lost', 'damaged']);
export type RepeatOverrideReason = z.infer<typeof repeatOverrideReasonSchema>;

export const eligibilityHistoryEntrySchema = z.object({
	issue_id: z.string().regex(/^distribution_issue:.+/),
	distributed_at: z.string().datetime()
});
export type EligibilityHistoryEntry = z.infer<typeof eligibilityHistoryEntrySchema>;

export const eligibilityInputSchema = z.object({
	distribution_type: distributionTypeSnapshotSchema,
	previous_receipts: z.array(eligibilityHistoryEntrySchema).default([]),
	repeat_override_reason: repeatOverrideReasonSchema.optional()
});
export type EligibilityInput = z.input<typeof eligibilityInputSchema>;

export const eligibilitySnapshotSchema = z.object({
	distribution_type: distributionTypeSnapshotSchema,
	had_previous_receipt: z.boolean(),
	previous_receipt_count: z.number().int().nonnegative(),
	eligible: z.boolean(),
	decision: z.enum(['consumable', 'first_receipt', 'repeat_rejected', 'repeat_override']),
	repeat_override_reason: repeatOverrideReasonSchema.optional()
});
export type EligibilitySnapshot = z.infer<typeof eligibilitySnapshotSchema>;

/**
 * Evaluate already-loaded history only. This is not an atomic lock: strict
 * concurrent first-issue exclusion and batch capacity serialization belong to
 * the Phase 3 persistence/coordination layer.
 */
export function evaluateDistributionEligibility(input: EligibilityInput): EligibilitySnapshot {
	const parsed = eligibilityInputSchema.parse(input);
	const previousReceiptCount = parsed.previous_receipts.length;
	const hadPreviousReceipt = previousReceiptCount > 0;

	if (parsed.distribution_type === 'consumable') {
		return {
			distribution_type: parsed.distribution_type,
			had_previous_receipt: hadPreviousReceipt,
			previous_receipt_count: previousReceiptCount,
			eligible: true,
			decision: 'consumable'
		};
	}

	if (!hadPreviousReceipt) {
		return {
			distribution_type: parsed.distribution_type,
			had_previous_receipt: false,
			previous_receipt_count: 0,
			eligible: true,
			decision: 'first_receipt'
		};
	}

	if (parsed.repeat_override_reason) {
		return {
			distribution_type: parsed.distribution_type,
			had_previous_receipt: true,
			previous_receipt_count: previousReceiptCount,
			eligible: true,
			decision: 'repeat_override',
			repeat_override_reason: parsed.repeat_override_reason
		};
	}

	return {
		distribution_type: parsed.distribution_type,
		had_previous_receipt: true,
		previous_receipt_count: previousReceiptCount,
		eligible: false,
		decision: 'repeat_rejected'
	};
}
