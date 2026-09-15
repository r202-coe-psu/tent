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

export const eligibilitySnapshotSchema = z
	.object({
		distribution_type: distributionTypeSnapshotSchema,
		had_previous_receipt: z.boolean(),
		previous_receipt_count: z.number().int().nonnegative(),
		eligible: z.boolean(),
		decision: z.enum(['consumable', 'first_receipt', 'repeat_rejected', 'repeat_override']),
		repeat_override_reason: repeatOverrideReasonSchema.optional()
	})
	.superRefine((s, ctx) => {
		if (s.had_previous_receipt !== s.previous_receipt_count > 0) {
			ctx.addIssue({
				code: 'custom',
				path: ['had_previous_receipt'],
				message: 'had_previous_receipt must match previous_receipt_count > 0'
			});
		}

		if (s.decision === 'consumable') {
			if (s.distribution_type !== 'consumable') {
				ctx.addIssue({
					code: 'custom',
					path: ['distribution_type'],
					message: "Consumable decision requires 'consumable' distribution type"
				});
			}
			if (!s.eligible) {
				ctx.addIssue({
					code: 'custom',
					path: ['eligible'],
					message: 'Consumable decision must be eligible'
				});
			}
			if (s.repeat_override_reason !== undefined) {
				ctx.addIssue({
					code: 'custom',
					path: ['repeat_override_reason'],
					message: 'Consumable decision cannot have a repeat override reason'
				});
			}
		} else if (s.decision === 'first_receipt') {
			if (s.distribution_type !== 'one_time') {
				ctx.addIssue({
					code: 'custom',
					path: ['distribution_type'],
					message: "First receipt decision requires 'one_time' distribution type"
				});
			}
			if (!s.eligible) {
				ctx.addIssue({
					code: 'custom',
					path: ['eligible'],
					message: 'First receipt must be eligible'
				});
			}
			if (s.had_previous_receipt || s.previous_receipt_count !== 0) {
				ctx.addIssue({
					code: 'custom',
					path: ['previous_receipt_count'],
					message: 'First receipt cannot have previous receipts'
				});
			}
			if (s.repeat_override_reason !== undefined) {
				ctx.addIssue({
					code: 'custom',
					path: ['repeat_override_reason'],
					message: 'First receipt cannot have a repeat override reason'
				});
			}
		} else if (s.decision === 'repeat_override') {
			if (s.distribution_type !== 'one_time') {
				ctx.addIssue({
					code: 'custom',
					path: ['distribution_type'],
					message: "Repeat override decision requires 'one_time' distribution type"
				});
			}
			if (!s.eligible) {
				ctx.addIssue({
					code: 'custom',
					path: ['eligible'],
					message: 'Repeat override must be eligible'
				});
			}
			if (!s.had_previous_receipt || s.previous_receipt_count <= 0) {
				ctx.addIssue({
					code: 'custom',
					path: ['previous_receipt_count'],
					message: 'Repeat override requires previous receipts'
				});
			}
			if (!s.repeat_override_reason) {
				ctx.addIssue({
					code: 'custom',
					path: ['repeat_override_reason'],
					message: 'Repeat override requires a valid override reason'
				});
			}
		} else if (s.decision === 'repeat_rejected') {
			if (s.distribution_type !== 'one_time') {
				ctx.addIssue({
					code: 'custom',
					path: ['distribution_type'],
					message: "Repeat rejected decision requires 'one_time' distribution type"
				});
			}
			if (s.eligible) {
				ctx.addIssue({
					code: 'custom',
					path: ['eligible'],
					message: 'Repeat rejected cannot be eligible'
				});
			}
			if (!s.had_previous_receipt || s.previous_receipt_count <= 0) {
				ctx.addIssue({
					code: 'custom',
					path: ['previous_receipt_count'],
					message: 'Repeat rejected requires previous receipts'
				});
			}
			if (s.repeat_override_reason !== undefined) {
				ctx.addIssue({
					code: 'custom',
					path: ['repeat_override_reason'],
					message: 'Repeat rejected cannot have a repeat override reason'
				});
			}
		}
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
