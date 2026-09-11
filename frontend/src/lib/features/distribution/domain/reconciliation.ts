import { z } from 'zod';
import { addQty, qtyGt, qtyGte, qtyStrCoerceNonNegativeSchema, subQty } from '$lib/utils/qty';

const optionalAuditNoteSchema = z.string().trim().min(1).optional();

export const reconciliationInputSchema = z
	.object({
		item_id: z.string().min(1),
		lot_ref: z.string().regex(/^stock_ledger:.+/, 'lot_ref must reference a stock ledger'),
		allocated_qty: qtyStrCoerceNonNegativeSchema,
		distributed_qty: qtyStrCoerceNonNegativeSchema,
		damaged_qty: qtyStrCoerceNonNegativeSchema,
		lost_qty: qtyStrCoerceNonNegativeSchema,
		damaged_note: optionalAuditNoteSchema,
		lost_note: optionalAuditNoteSchema
	})
	.superRefine((row, ctx) => {
		if (qtyGt(row.damaged_qty, 0) && !row.damaged_note) {
			ctx.addIssue({
				code: 'custom',
				path: ['damaged_note'],
				message: 'damaged_note is required when damaged_qty is greater than zero'
			});
		}
		if (qtyGt(row.lost_qty, 0) && !row.lost_note) {
			ctx.addIssue({
				code: 'custom',
				path: ['lost_note'],
				message: 'lost_note is required when lost_qty is greater than zero'
			});
		}
	});

export type ReconciliationInput = z.input<typeof reconciliationInputSchema>;

export const reconciliationRowSchema = reconciliationInputSchema.safeExtend({
	return_qty: qtyStrCoerceNonNegativeSchema
});

export type ReconciliationRow = z.infer<typeof reconciliationRowSchema>;

/**
 * Client-provided input contract for closing a batch.
 * The client is authoritative ONLY for operator-entered facts (damaged, lost, notes).
 * It CANNOT specify allocated_qty, distributed_qty, return_qty, status, or timestamps.
 */
export const closeBatchItemInputSchema = z
	.object({
		item_id: z.string().min(1),
		lot_ref: z
			.string()
			.regex(/^stock_ledger:.+/, 'lot_ref must reference a stock ledger')
			.optional(),
		damaged_qty: qtyStrCoerceNonNegativeSchema.default('0'),
		lost_qty: qtyStrCoerceNonNegativeSchema.default('0'),
		damaged_note: optionalAuditNoteSchema,
		lost_note: optionalAuditNoteSchema
	})
	.superRefine((row, ctx) => {
		if (qtyGt(row.damaged_qty, 0) && !row.damaged_note) {
			ctx.addIssue({
				code: 'custom',
				path: ['damaged_note'],
				message: 'damaged_note is required when damaged_qty is greater than zero'
			});
		}
		if (qtyGt(row.lost_qty, 0) && !row.lost_note) {
			ctx.addIssue({
				code: 'custom',
				path: ['lost_note'],
				message: 'lost_note is required when lost_qty is greater than zero'
			});
		}
	});

export type CloseBatchItemInput = z.input<typeof closeBatchItemInputSchema>;

export const closeBatchInputSchema = z.object({
	reconciliation: z.array(closeBatchItemInputSchema).default([])
});

export type CloseBatchInput = z.input<typeof closeBatchInputSchema>;

export class ReconciliationIntegrityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ReconciliationIntegrityError';
	}
}

/**
 * Calculate the auditable closing snapshot with exact qty-string arithmetic.
 * A negative remainder means the source totals are already inconsistent, so
 * the calculation fails closed instead of hiding the over-distribution.
 */
export function calculateReconciliation(input: ReconciliationInput): ReconciliationRow {
	const row = reconciliationInputSchema.parse(input);
	const accounted = addQty(addQty(row.distributed_qty, row.damaged_qty), row.lost_qty);
	const returnQty = subQty(row.allocated_qty, accounted);

	if (!qtyGte(returnQty, 0)) {
		throw new ReconciliationIntegrityError(
			`Reconciliation exceeds allocation for ${row.item_id} at ${row.lot_ref}`
		);
	}

	return reconciliationRowSchema.parse({ ...row, return_qty: returnQty });
}
