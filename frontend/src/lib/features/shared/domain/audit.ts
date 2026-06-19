import { z } from 'zod';
import { type BaseDoc, type AuthorContext, type Timestamp, makeDoc, now } from '$lib/db/model';

export const auditActionSchema = z.enum([
	'duplicate_override',
	'retro_edit',
	'export',
	'purge',
	'conflict_resolved',
	'manual_adjust',
	'created',
	'other'
]);
export type AuditAction = z.infer<typeof auditActionSchema>;

export interface AuditEntry extends BaseDoc {
	type: 'audit';
	action: AuditAction;
	target_type: string;
	target_id: string;
	reason: string;
	context?: Record<string, unknown>;
	occurred_at: Timestamp;
}

export const isAuditEntry = (d: unknown): d is AuditEntry =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'audit';

export const auditEntryInputSchema = z.object({
	action: auditActionSchema,
	target_type: z.string().min(1),
	target_id: z.string().min(1),
	reason: z.string().min(1),
	context: z.record(z.string(), z.unknown()).optional(),
	occurred_at: z.string().optional()
});
export type AuditEntryInput = z.input<typeof auditEntryInputSchema>;

export function createAuditEntry(input: AuditEntryInput, ctx: AuthorContext): AuditEntry {
	const d = auditEntryInputSchema.parse(input);
	return makeDoc(
		'audit',
		1,
		{
			action: d.action,
			target_type: d.target_type,
			target_id: d.target_id,
			reason: d.reason,
			...(d.context ? { context: d.context } : {}),
			occurred_at: d.occurred_at ?? now()
		},
		ctx
	);
}
