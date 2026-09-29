import { ConflictError } from '$lib/utils/errors';
import { allDocsByType, getDoc, putDocStrict } from '$lib/db/couch-db';
import { getShelterDb } from '$lib/db/shelter';
import { makeDoc } from '$lib/db/model';
import type { SopRatioKey } from '$lib/features/sop-ratios';
import {
	DAILY_SOP_ROLE_DOCUMENT_TYPE,
	DAILY_SOP_ROLE_SCHEMA_VERSION,
	DAILY_SOP_ROLES,
	canAssessRole,
	createEmptyRoleDraft,
	dailySopBangkokDate,
	dailySopRoleAssessmentSchema,
	isDailySopRoleAssessment,
	metricForQuestion,
	promptForQuestion,
	questionsForRole,
	roleAssessmentStatusFor,
	summarizeRoleDraft,
	type DailySopRoleAssessment,
	type DailySopRoleCode,
	type DailySopRoleControlSnapshot,
	type DailySopRoleDraft
} from '../domain/daily-sop';
import type { DailySopRoleAuthorContext, DailySopRoleRepository } from './daily-sop.repository';

export const DAILY_SOP_ROLE_ID_PREFIX = `${DAILY_SOP_ROLE_DOCUMENT_TYPE}:`;

export const buildDailySopRoleId = (shelterCode: string, date: string, role: DailySopRoleCode) =>
	`${DAILY_SOP_ROLE_ID_PREFIX}${shelterCode}:${date}:${role}`;

export class DailySopRoleRemoteRepository implements DailySopRoleRepository {
	constructor(private readonly dbName = getShelterDb()) {}

	async list(shelterCode: string): Promise<DailySopRoleAssessment[]> {
		const records = await allDocsByType(
			this.dbName,
			DAILY_SOP_ROLE_DOCUMENT_TYPE,
			isDailySopRoleAssessment
		);
		return records
			.map((record) => dailySopRoleAssessmentSchema.parse(record))
			.filter((record) => record.shelter_code === shelterCode)
			.sort(
				(a, b) =>
					b.assessment_date.localeCompare(a.assessment_date) ||
					a.role_code.localeCompare(b.role_code)
			);
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
		ctx: DailySopRoleAuthorContext
	): Promise<DailySopRoleAssessment> {
		if (date !== dailySopBangkokDate()) {
			throw new Error(
				'Daily SOP role assessments can only be saved for today; other dates are read-only.'
			);
		}
		assertAuthorized(role, ctx);
		const id = buildDailySopRoleId(ctx.shelterCode, date, role);
		const existing = await this.read(id);
		if (existing) return this.update(existing, draft, ctx);

		const timestamp = new Date().toISOString();
		const snapshot = buildControlSnapshots(
			role,
			draft,
			ctx.createdBy,
			ctx.assessorName ?? ctx.createdBy,
			timestamp,
			ctx.sopRatios
		);
		const counts = summarizeRoleDraft(draft, role);
		const roleDefinition = DAILY_SOP_ROLES.find((item) => item.code === role)!;
		const body = {
			assessment_date: date,
			role_code: role,
			role_key: roleDefinition.key,
			role_label: roleDefinition.label,
			assessed_at: timestamp,
			assessor_name: ctx.assessorName ?? ctx.createdBy,
			status: roleAssessmentStatusFor(draft, role),
			pass_count: counts.pass,
			fail_count: counts.fail,
			pending_count: counts.pending,
			unanswered_count: counts.unanswered,
			controls: snapshot
		};
		const doc = makeDoc(
			DAILY_SOP_ROLE_DOCUMENT_TYPE,
			DAILY_SOP_ROLE_SCHEMA_VERSION,
			body,
			ctx,
			`${ctx.shelterCode}:${date}:${role}`
		) as DailySopRoleAssessment;
		const validated = dailySopRoleAssessmentSchema.parse(doc);

		try {
			return await putDocStrict(this.dbName, validated);
		} catch (error) {
			if (error instanceof ConflictError) {
				const latest = await this.read(id);
				if (latest) return this.update(latest, draft, ctx);
			}
			throw error;
		}
	}

	private async update(
		existing: DailySopRoleAssessment,
		draft: DailySopRoleDraft,
		ctx: DailySopRoleAuthorContext
	): Promise<DailySopRoleAssessment> {
		if (ctx.shelterCode !== existing.shelter_code)
			throw new Error('Daily SOP cannot be edited outside its shelter scope.');
		if (!canAssessRole(existing.role_code, ctx.roles ?? [], ctx.shelterCode)) {
			throw new Error(
				`Unauthorized: ${existing.role_code} Daily SOP requires the role owner or shelter_manager.`
			);
		}
		const current = existing._rev ? existing : await this.read(existing._id);
		if (!current?._rev)
			throw new Error('Daily SOP role assessment revision is required for editing.');
		const timestamp = new Date().toISOString();
		const counts = summarizeRoleDraft(draft, existing.role_code);
		const controls = current.controls.map((previous) => {
			const answer = draft[previous.id];
			if (!answer) return previous;
			const next = { ...previous, ...answer, measured_values: { ...answer.measured_values } };
			const answerChanged = didQuestionAnswerChange(previous, next);
			return {
				...next,
				checked_by: answerChanged ? ctx.createdBy : previous.checked_by,
				checked_by_name: answerChanged
					? (ctx.assessorName ?? ctx.createdBy)
					: previous.checked_by_name,
				checked_at: answerChanged ? timestamp : previous.checked_at
			};
		});
		const updated: DailySopRoleAssessment = {
			...existing,
			_rev: current._rev,
			assessor_name: ctx.assessorName ?? ctx.createdBy,
			status: roleAssessmentStatusFor(draft, existing.role_code),
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
): boolean {
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
		const value = draft[question.id] ?? createEmptyRoleDraft(role)[question.id];
		const metric = metricForQuestion(question.id, sopRatios);
		return {
			id: question.id,
			question: promptForQuestion(question, sopRatios),
			check_method: question.checkMethod,
			pass_criteria: metric?.formula ?? question.passCriteria,
			record_values: question.recordValues,
			metric_spec: metric
				? {
						fields: metric.fields,
						threshold: metric.threshold,
						parameter: metric.parameter
					}
				: null,
			status: value.status,
			notes: value.notes,
			observations: value.observations,
			measured_values: { ...value.measured_values },
			checked_by: checkedBy,
			checked_by_name: checkedByName,
			checked_at: timestamp
		};
	});
}

function assertAuthorized(role: DailySopRoleCode, ctx: DailySopRoleAuthorContext) {
	if (!canAssessRole(role, ctx.roles ?? [], ctx.shelterCode)) {
		throw new Error(`Unauthorized: ${role} Daily SOP requires the role owner or shelter_manager.`);
	}
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
