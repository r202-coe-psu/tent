import { z } from 'zod';
import { findDocsPage, getDoc, putDocStrict } from '$lib/db/couch-db';
import { getShelterDb } from '$lib/db/shelter';
import { makeDoc } from '$lib/db/model';
import type { SopRatioKey } from '$lib/features/sop-ratios';
import { DAILY_SOP_ROLE_QUESTION_VERSION } from '../domain/daily-sop.questions';
import {
	DAILY_SOP_ROLE_DOCUMENT_TYPE,
	DAILY_SOP_ROLE_SCHEMA_VERSION,
	DAILY_SOP_ROLES,
	canAssessRole,
	createEmptyRoleDraft,
	dailySopBangkokDate,
	isDailySopUtcTimestamp,
	dailySopRoleAssessmentSchema,
	hasRoleDraftInput,
	isDailySopRoleAssessment,
	metricForQuestion,
	questionText,
	questionsForRole,
	roleAssessmentStatusFor,
	summarizeRoleDraft,
	type DailySopRoleAssessment,
	type DailySopRoleCode,
	type DailySopRoleControlSnapshot,
	type DailySopRoleDraft
} from '../domain/daily-sop';
import type {
	DailySopRoleAuthorContext,
	DailySopRolePage,
	DailySopRoleRepository
} from './daily-sop.repository';

export const DAILY_SOP_ROLE_ID_PREFIX = `${DAILY_SOP_ROLE_DOCUMENT_TYPE}:`;
export const DAILY_SOP_ROLE_PAGE_SIZE = 100;

export const buildDailySopRoleId = (shelterCode: string, date: string, role: DailySopRoleCode) =>
	`${DAILY_SOP_ROLE_ID_PREFIX}${shelterCode}:${date}:${role}`;

export class DailySopRoleRemoteRepository implements DailySopRoleRepository {
	constructor(private readonly dbName = getShelterDb()) {}

	async listPage(
		shelterCode: string,
		bookmark: string | null = null,
		asOfDate = dailySopBangkokDate()
	): Promise<DailySopRolePage> {
		const response = await findDocsPage<unknown>(this.dbName, {
			selector: {
				type: DAILY_SOP_ROLE_DOCUMENT_TYPE,
				shelter_code: shelterCode,
				assessment_date: { $lte: asOfDate }
			},
			sort: [
				{ type: 'desc' },
				{ shelter_code: 'desc' },
				{ assessment_date: 'desc' },
				{ role_code: 'desc' }
			],
			use_index: ['_design/daily-sop-role-assessment', 'daily-sop-role-assessment-by-shelter-date'],
			allow_fallback: false,
			limit: DAILY_SOP_ROLE_PAGE_SIZE,
			...(bookmark ? { bookmark } : {})
		});
		// Count raw documents for bookmarks even when invalid documents are skipped.
		const items = response.docs.flatMap((record) => {
			const parsed = dailySopRoleAssessmentSchema.safeParse(record);
			return parsed.success ? [parsed.data] : [];
		});
		if (
			items.some((item) => item.shelter_code !== shelterCode || item.assessment_date > asOfDate)
		) {
			throw new Error('Daily SOP history query returned a document outside its selector.');
		}
		const fullPage = response.docs.length === DAILY_SOP_ROLE_PAGE_SIZE;
		if (fullPage && !response.bookmark) {
			throw new Error('Daily SOP history page is missing the CouchDB bookmark.');
		}
		return {
			items,
			bookmark: fullPage ? response.bookmark : null
		};
	}

	async read(id: string): Promise<DailySopRoleAssessment | null> {
		if (!id.startsWith(DAILY_SOP_ROLE_ID_PREFIX)) return null;
		const record = await getDoc<DailySopRoleAssessment>(this.dbName, id);
		return record && isDailySopRoleAssessment(record)
			? dailySopRoleAssessmentSchema.parse(record)
			: null;
	}

	findByShelterDateRole(shelterCode: string, date: string, role: DailySopRoleCode) {
		return this.read(buildDailySopRoleId(shelterCode, date, role));
	}

	async createOrUpdate(
		role: DailySopRoleCode,
		draft: DailySopRoleDraft,
		date: string,
		ctx: DailySopRoleAuthorContext,
		baseAssessment: DailySopRoleAssessment | null = null
	): Promise<DailySopRoleAssessment> {
		if (date !== dailySopBangkokDate()) {
			throw new Error(
				'Daily SOP role assessments can only be saved for today; other dates are read-only.'
			);
		}
		assertAuthorized(role, ctx);
		if (!hasRoleDraftInput(draft, role))
			throw new Error('An empty Daily SOP assessment is not saved.');
		const id = buildDailySopRoleId(ctx.shelterCode, date, role);
		if (baseAssessment) {
			if (
				baseAssessment._id !== id ||
				baseAssessment.role_code !== role ||
				baseAssessment.shelter_code !== ctx.shelterCode
			) {
				throw new Error(
					'Daily SOP base assessment does not match the current shelter, date, and role.'
				);
			}
			return this.update(baseAssessment, draft, ctx);
		}

		const timestamp = new Date().toISOString();
		const controls = buildControlSnapshots(
			role,
			draft,
			ctx.createdBy,
			ctx.assessorName ?? ctx.createdBy,
			timestamp,
			ctx.sopRatios
		);
		const counts = summarizeRoleDraft(draft, role);
		const roleDefinition = DAILY_SOP_ROLES.find((item) => item.code === role)!;
		const doc = makeDoc(
			DAILY_SOP_ROLE_DOCUMENT_TYPE,
			DAILY_SOP_ROLE_SCHEMA_VERSION,
			{
				assessment_date: date,
				role_code: role,
				role_key: roleDefinition.key,
				role_label: roleDefinition.label,
				question_set_version: DAILY_SOP_ROLE_QUESTION_VERSION,
				assessed_at: timestamp,
				assessor_name: ctx.assessorName ?? ctx.createdBy,
				status: roleAssessmentStatusFor(draft, role),
				pass_count: counts.pass,
				fail_count: counts.fail,
				pending_count: counts.pending,
				unanswered_count: counts.unanswered,
				controls
			},
			ctx,
			`${ctx.shelterCode}:${date}:${role}`
		);
		return putDocStrict(this.dbName, dailySopRoleAssessmentSchema.parse(doc));
	}

	private async update(
		base: DailySopRoleAssessment,
		draft: DailySopRoleDraft,
		ctx: DailySopRoleAuthorContext
	): Promise<DailySopRoleAssessment> {
		if (!base._rev) throw new Error('Daily SOP role assessment revision is required for editing.');
		if (ctx.shelterCode !== base.shelter_code)
			throw new Error('Daily SOP cannot be edited outside its shelter scope.');
		assertAuthorized(base.role_code, ctx);
		const timestamp = new Date().toISOString();
		const counts = summarizeRoleDraft(draft, base.role_code);
		const controls = base.controls.map((previous) => {
			const answer = draft[previous.id];
			if (!answer) throw new Error(`Daily SOP draft is missing ${previous.id}.`);
			const next = { ...previous, ...answer, measured_values: { ...answer.measured_values } };
			const changed = didQuestionAnswerChange(previous, next);
			return {
				...next,
				checked_by: changed ? ctx.createdBy : previous.checked_by,
				...(changed
					? { checked_by_name: ctx.assessorName ?? ctx.createdBy, checked_at: timestamp }
					: { checked_by_name: previous.checked_by_name, checked_at: previous.checked_at })
			};
		});
		const updated: DailySopRoleAssessment = {
			...base,
			_rev: base._rev,
			status: roleAssessmentStatusFor(draft, base.role_code),
			pass_count: counts.pass,
			fail_count: counts.fail,
			pending_count: counts.pending,
			unanswered_count: counts.unanswered,
			controls,
			updated_at: timestamp
		};
		return putDocStrict(this.dbName, dailySopRoleAssessmentSchema.parse(updated));
	}
}

function didQuestionAnswerChange(
	previous: DailySopRoleControlSnapshot,
	next: DailySopRoleControlSnapshot
) {
	if (
		previous.status !== next.status ||
		previous.notes !== next.notes ||
		previous.observations !== next.observations
	)
		return true;
	const previousKeys = Object.keys(previous.measured_values).sort();
	const nextKeys = Object.keys(next.measured_values).sort();
	return (
		previousKeys.length !== nextKeys.length ||
		previousKeys.some(
			(key, index) =>
				key !== nextKeys[index] || previous.measured_values[key] !== next.measured_values[key]
		)
	);
}

function buildControlSnapshots(
	role: DailySopRoleCode,
	draft: DailySopRoleDraft,
	checkedBy: string,
	checkedByName: string,
	timestamp: string,
	sopRatios?: Partial<Record<SopRatioKey, string>>
): DailySopRoleControlSnapshot[] {
	return questionsForRole(role).map((question) => {
		const answer = draft[question.id] ?? createEmptyRoleDraft(role)[question.id];
		const metric = metricForQuestion(question.id, sopRatios);
		return {
			id: question.id,
			question: questionText(question, sopRatios),
			metric_spec: metric
				? {
						fields: metric.fields,
						threshold: metric.threshold,
						...(metric.parameter ? { parameter: metric.parameter } : {})
					}
				: null,
			status: answer.status,
			notes: answer.notes,
			observations: answer.observations,
			measured_values: metric
				? Object.fromEntries(
						metric.fields.map((item) => [item.key, answer.measured_values[item.key] ?? null])
					)
				: {},
			checked_by: checkedBy,
			checked_by_name: checkedByName,
			checked_at: timestamp
		};
	});
}

function assertAuthorized(role: DailySopRoleCode, ctx: DailySopRoleAuthorContext) {
	if (!canAssessRole(role, ctx.roles ?? [], ctx.shelterCode)) {
		throw new Error(`Unauthorized: ${role} Daily SOP requires the role owner or shelter manager.`);
	}
}

const dailySopStockStatusSchema = z
	.object({
		shelter_code: z.string(),
		last_updated: z.string().refine(isDailySopUtcTimestamp).nullable(),
		items: z.array(
			z
				.object({
					item_id: z.string().min(1),
					name: z.string().min(1),
					unit: z.string().min(1),
					qty_on_hand: z
						.string()
						.refine((value) => value.trim() !== '' && Number.isFinite(Number(value)))
				})
				.passthrough()
		)
	})
	.passthrough();

export type DailySopStockStatus = z.infer<typeof dailySopStockStatusSchema>;

export async function fetchDailySopStockStatus(shelterCode: string): Promise<DailySopStockStatus> {
	const response = await fetch(`/api/v1/shelters/${encodeURIComponent(shelterCode)}/stock-status`);
	if (!response.ok) throw new Error(`Stock status request failed (${response.status}).`);
	const raw: unknown = await response.json();
	const parsed = dailySopStockStatusSchema.parse(raw);
	if (parsed.shelter_code !== shelterCode) {
		throw new Error('Stock status response belongs to a different shelter.');
	}
	return {
		shelter_code: parsed.shelter_code,
		last_updated: parsed.last_updated,
		items: parsed.items.map(({ item_id, name, unit, qty_on_hand }) => ({
			item_id,
			name,
			unit,
			qty_on_hand
		}))
	};
}

let singleton: DailySopRoleRemoteRepository | null = null;
let singletonDb: string | null = null;

export const dailySopRoleRepository = (): DailySopRoleRemoteRepository => {
	const db = getShelterDb();
	if (!singleton || singletonDb !== db) {
		singleton = new DailySopRoleRemoteRepository(db);
		singletonDb = db;
	}
	return singleton;
};
