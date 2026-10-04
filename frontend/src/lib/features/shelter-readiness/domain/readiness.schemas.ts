import { z } from 'zod';

export const ReadinessTierSchema = z.enum(['community', 'local_admin', 'city']);

export const ReadinessSectionIdSchema = z.enum([
	'structure_and_space',
	'basic_needs',
	'shelter_management'
]);

export const ReadinessImportanceSchema = z.enum(['mandatory', 'recommended', 'optional']);

export const ReadinessItemStatusSchema = z.enum(['none', 'partial', 'fully_ready', 'unassessed']);

export const ReadinessVerdictSchema = z.enum([
	'ready',
	'conditional_pass',
	'not_ready',
	'pending_improvement'
]);

export const AssessmentLifecycleStatusSchema = z.enum(['draft', 'submitted']);

export const ReadinessQuestionAnswerSchema = z.object({
	question_id: z.string().min(1),
	section_id: ReadinessSectionIdSchema,
	title: z.string().min(1),
	description: z.string().optional(),
	importance: ReadinessImportanceSchema,
	status: ReadinessItemStatusSchema,
	note: z.string().optional()
});

export const ReadinessHeaderInfoSchema = z.object({
	shelter_name: z.string().default(''),
	community_name: z.string().optional().default(''),
	operating_agency: z.string().default(''),
	max_capacity: z.number().int().nonnegative().default(0),
	phone_contact: z.string().default(''),
	building_type: z.string().default(''),
	location_address: z.string().default(''),
	assessor_name: z.string().default(''),
	assessed_date: z.string().default('')
});

export const ReadinessSummaryTallySchema = z.object({
	total_items: z.number().int().nonnegative(),
	answered_items: z.number().int().nonnegative(),
	fully_ready_count: z.number().int().nonnegative(),
	partial_count: z.number().int().nonnegative(),
	none_count: z.number().int().nonnegative(),
	unassessed_count: z.number().int().nonnegative(),
	mandatory_unanswered_count: z.number().int().nonnegative(),
	mandatory_none_count: z.number().int().nonnegative()
});

export const ReadinessAuditEntrySchema = z.object({
	edited_by: z.string().min(1),
	edited_at: z.string().min(1),
	reason: z.string().min(1, 'กรุณาระบุเหตุผลการแก้ไข'),
	previous_verdict: ReadinessVerdictSchema.nullable().optional()
});

export const ShelterReadinessAssessmentDocSchema = z.object({
	_id: z.string().min(1),
	_rev: z.string().optional(),
	type: z.literal('shelter_readiness_assessment'),
	schema_v: z.literal(1),
	shelter_code: z.string().min(1),
	tier: ReadinessTierSchema,
	header: ReadinessHeaderInfoSchema,
	status: AssessmentLifecycleStatusSchema,
	verdict: ReadinessVerdictSchema.nullable(),
	justification_note: z.string(),
	summary: ReadinessSummaryTallySchema,
	items: z.array(ReadinessQuestionAnswerSchema),
	created_by: z.string().min(1),
	created_at: z.string().min(1),
	updated_at: z.string().min(1),
	submitted_by: z.string().optional(),
	submitted_at: z.string().optional(),
	edit_history: z.array(ReadinessAuditEntrySchema)
});

export type ValidatedShelterReadinessDoc = z.infer<typeof ShelterReadinessAssessmentDocSchema>;
