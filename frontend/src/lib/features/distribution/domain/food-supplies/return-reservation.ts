import { z } from 'zod';
import { type AuthorContext, type BaseDoc, makeDoc } from '$lib/db/model';
import { distributionLogIdSchema, ULID_PATTERN } from './shared';
import { returnConditionSchema, type ReturnCondition } from './distribution-log';

export { returnConditionSchema, type ReturnCondition };
export const physicalReturnConditionSchema = returnConditionSchema;
export type PhysicalReturnCondition = ReturnCondition;

export const loanReturnReservationModeSchema = z.enum(['PHYSICAL', 'BULK', 'NON_PHYSICAL']);
export type LoanReturnReservationMode = z.infer<typeof loanReturnReservationModeSchema>;

export const loanReturnReservationStatusSchema = z.enum([
	'RESERVED',
	'FENCED',
	'COMMITTED',
	'ABORTED'
]);
export type LoanReturnReservationStatus = z.infer<typeof loanReturnReservationStatusSchema>;

export const nonPhysicalClearReasonSchema = z.enum(['lost', 'waived']);
export type NonPhysicalClearReason = z.infer<typeof nonPhysicalClearReasonSchema>;

export const loanReturnReservationIdSchema = z
	.string()
	.regex(new RegExp(`^loan_return_reservation:${ULID_PATTERN}$`));

export const operationUlidSchema = z.string().regex(new RegExp(`^${ULID_PATTERN}$`));

export const loanReturnReservationDocSchema = z
	.object({
		_id: loanReturnReservationIdSchema,
		_rev: z.string().optional(),
		type: z.literal('loan_return_reservation'),
		schema_v: z.literal(1),
		shelter_code: z.string().min(1),
		distribution_log_id: distributionLogIdSchema,
		mode: loanReturnReservationModeSchema,
		status: loanReturnReservationStatusSchema,
		operation_id: operationUlidSchema,
		operation_by: z.string().min(1),

		// Durable intent fields (attempt-scoped):
		// PHYSICAL:
		// Persist the cumulative target so replay can derive and verify the exact
		// physical delta against the authoritative DistributionLog.
		qty_returned: z
			.string()
			.regex(/^\d+(\.\d+)?$/)
			.optional(),
		return_condition: returnConditionSchema.optional(),

		// BULK:
		bulk_pool_id: z
			.string()
			.regex(new RegExp(`^bulk_return_pool:${ULID_PATTERN}$`))
			.optional(),
		claimed_qty: z
			.string()
			.regex(/^\d+(\.\d+)?$/)
			.optional(),

		// NON_PHYSICAL:
		clear_reason: nonPhysicalClearReasonSchema.optional(),

		notes: z.string().trim().min(1).optional(),
		created_at: z.string().datetime(),
		created_by: z.string().min(1),
		updated_at: z.string().datetime()
	})
	.superRefine((data, ctx) => {
		if (data.mode === 'PHYSICAL') {
			if (!data.qty_returned) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'PHYSICAL reservation requires qty_returned',
					path: ['qty_returned']
				});
			}
			if (!data.return_condition) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'PHYSICAL reservation requires return_condition',
					path: ['return_condition']
				});
			}
		} else if (data.mode === 'BULK') {
			if (!data.bulk_pool_id) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'BULK reservation requires bulk_pool_id',
					path: ['bulk_pool_id']
				});
			}
			if (!data.claimed_qty) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'BULK reservation requires claimed_qty',
					path: ['claimed_qty']
				});
			}
		} else if (data.mode === 'NON_PHYSICAL') {
			if (!data.clear_reason) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'NON_PHYSICAL reservation requires clear_reason',
					path: ['clear_reason']
				});
			}
		}
	});

export type LoanReturnReservation = BaseDoc & z.infer<typeof loanReturnReservationDocSchema>;

export function deriveReservationIdFromDistributionLog(distributionLogId: string): string {
	const match = distributionLogId.match(new RegExp(`^distribution_log:(${ULID_PATTERN})$`));
	if (!match) {
		throw new Error(`Invalid distribution_log ID format: ${distributionLogId}`);
	}
	return `loan_return_reservation:${match[1]}`;
}

export const createLoanReturnReservationInputSchema = z.object({
	distribution_log_id: distributionLogIdSchema,
	operation_id: operationUlidSchema,
	mode: loanReturnReservationModeSchema,
	operation_by: z.string().min(1).optional(),
	qty_returned: z
		.string()
		.regex(/^\d+(\.\d+)?$/)
		.optional(),
	return_condition: returnConditionSchema.optional(),
	bulk_pool_id: z
		.string()
		.regex(new RegExp(`^bulk_return_pool:${ULID_PATTERN}$`))
		.optional(),
	claimed_qty: z
		.string()
		.regex(/^\d+(\.\d+)?$/)
		.optional(),
	clear_reason: nonPhysicalClearReasonSchema.optional(),
	notes: z.string().trim().min(1).optional()
});

export type CreateLoanReturnReservationInput = z.infer<
	typeof createLoanReturnReservationInputSchema
>;

export function createLoanReturnReservation(
	input: CreateLoanReturnReservationInput,
	ctx: AuthorContext
): LoanReturnReservation {
	const parsed = createLoanReturnReservationInputSchema.parse(input);
	const resId = deriveReservationIdFromDistributionLog(parsed.distribution_log_id);
	const actorName = ctx.createdBy;

	const doc = makeDoc(
		'loan_return_reservation',
		1,
		{
			distribution_log_id: parsed.distribution_log_id,
			operation_id: parsed.operation_id,
			mode: parsed.mode,
			status: 'RESERVED' as const,
			operation_by: parsed.operation_by ?? actorName,
			...(parsed.qty_returned !== undefined ? { qty_returned: parsed.qty_returned } : {}),
			...(parsed.return_condition !== undefined
				? { return_condition: parsed.return_condition }
				: {}),
			...(parsed.bulk_pool_id !== undefined ? { bulk_pool_id: parsed.bulk_pool_id } : {}),
			...(parsed.claimed_qty !== undefined ? { claimed_qty: parsed.claimed_qty } : {}),
			...(parsed.clear_reason !== undefined ? { clear_reason: parsed.clear_reason } : {}),
			...(parsed.notes ? { notes: parsed.notes } : {})
		},
		ctx,
		resId.replace('loan_return_reservation:', '')
	);

	return loanReturnReservationDocSchema.parse(doc);
}

export function assertLoanReturnReservationPermanentImmutability(
	existing: LoanReturnReservation,
	next: LoanReturnReservation
): void {
	const immutableFields: (keyof LoanReturnReservation)[] = [
		'_id',
		'type',
		'schema_v',
		'shelter_code',
		'distribution_log_id',
		'created_at',
		'created_by'
	];

	for (const field of immutableFields) {
		if (existing[field] !== next[field]) {
			throw new Error(`loan_return_reservation.${String(field)} is permanently immutable`);
		}
	}
}

export const VALID_RESERVATION_TRANSITIONS: Record<
	LoanReturnReservationStatus,
	LoanReturnReservationStatus[]
> = {
	RESERVED: ['FENCED', 'ABORTED'],
	FENCED: ['COMMITTED'],
	COMMITTED: ['RESERVED'],
	ABORTED: ['RESERVED']
};

export function isAllowedReservationTransition(
	from: LoanReturnReservationStatus,
	to: LoanReturnReservationStatus
): boolean {
	const allowed = VALID_RESERVATION_TRANSITIONS[from] || [];
	return allowed.includes(to);
}

export function assertLoanReturnReservationTransition(
	existing: LoanReturnReservation,
	next: LoanReturnReservation
): void {
	assertLoanReturnReservationPermanentImmutability(existing, next);

	if (existing.status !== next.status) {
		if (!isAllowedReservationTransition(existing.status, next.status)) {
			throw new Error(
				`Invalid loan_return_reservation transition from ${existing.status} to ${next.status}`
			);
		}
	}

	const isReinitialization =
		(existing.status === 'ABORTED' || existing.status === 'COMMITTED') &&
		next.status === 'RESERVED';

	if (!isReinitialization) {
		const attemptScopedFields: (keyof LoanReturnReservation)[] = [
			'operation_id',
			'mode',
			'operation_by',
			'qty_returned',
			'return_condition',
			'bulk_pool_id',
			'claimed_qty',
			'clear_reason'
		];

		for (const field of attemptScopedFields) {
			if (existing[field] !== next[field]) {
				throw new Error(`loan_return_reservation.${String(field)} is attempt-scoped immutable`);
			}
		}
	}
}
