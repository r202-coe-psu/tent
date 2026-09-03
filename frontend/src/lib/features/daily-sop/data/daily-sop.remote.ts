import { ConflictError } from '$lib/utils/errors';
import { getDoc, allDocsByType, putDocStrict } from '$lib/db/couch-db';
import { getShelterDb } from '$lib/db/shelter';
import { makeDoc } from '$lib/db/model';
import {
	DAILY_SOP_DOCUMENT_TYPE,
	DAILY_SOP_QUESTIONS,
	DAILY_SOP_SCHEMA_VERSION,
	LIFELINE_KEYS,
	assessmentStatusFor,
	dailySopAssessmentSchema,
	isDailySopAssessment,
	summarizeDraft,
	toStoredStatus,
	type DailySopAssessment,
	type DailySopDraft
} from '../domain/daily-sop';
import type { DailySopAuthorContext, DailySopRepository } from './daily-sop.repository';

export const DAILY_SOP_ID_PREFIX = `${DAILY_SOP_DOCUMENT_TYPE}:`;

export const buildDailySopId = (shelterCode: string, date: string): string =>
	`${DAILY_SOP_ID_PREFIX}${shelterCode}:${date}`;

export class DailySopRemoteRepository implements DailySopRepository {
	constructor(private readonly dbName = getShelterDb()) {}

	async list(shelterCode: string): Promise<DailySopAssessment[]> {
		const records = await allDocsByType(this.dbName, DAILY_SOP_DOCUMENT_TYPE, isDailySopAssessment);
		return records
			.map((record) => dailySopAssessmentSchema.parse(record))
			.filter((record) => record.shelter_code === shelterCode)
			.sort(
				(a, b) =>
					b.assessment_date.localeCompare(a.assessment_date) ||
					b.assessed_at.localeCompare(a.assessed_at)
			);
	}

	async read(id: string): Promise<DailySopAssessment | null> {
		if (!id.startsWith(DAILY_SOP_ID_PREFIX)) return null;
		const record = await getDoc<DailySopAssessment>(this.dbName, id);
		return record && isDailySopAssessment(record) ? dailySopAssessmentSchema.parse(record) : null;
	}

	findByShelterDate(shelterCode: string, date: string): Promise<DailySopAssessment | null> {
		return this.read(buildDailySopId(shelterCode, date));
	}

	async createCompleted(
		draft: DailySopDraft,
		date: string,
		ctx: DailySopAuthorContext
	): Promise<
		| { kind: 'created'; assessment: DailySopAssessment }
		| { kind: 'duplicate'; assessment: DailySopAssessment }
	> {
		const hasAnswer =
			Object.values(draft.answeredControls).some(Boolean) ||
			LIFELINE_KEYS.some((key) => draft.lifelines[key] !== null);
		if (!hasAnswer)
			throw new Error('Daily SOP requires at least one selected status before saving.');
		const assessedAt = new Date().toISOString();
		const summary = summarizeDraft(draft);
		const body = {
			assessment_date: date,
			assessed_at: assessedAt,
			assessor_name: ctx.assessorName ?? ctx.createdBy,
			status: assessmentStatusFor(draft),
			progress_percent: summary.progressPercent,
			pass_percent: summary.passPercent,
			risk_label: summary.riskLabel,
			controls: DAILY_SOP_QUESTIONS.map((question) => ({
				...controlSnapshotAudit(draft, question.id, ctx.createdBy, assessedAt),
				id: question.id,
				section_id: question.sectionId,
				question: question.prompt,
				status: toStoredStatus(draft.controls[question.id]),
				answered:
					draft.answeredControls[question.id] === true || draft.controls[question.id] !== 'Pending'
			})),
			lifelines: Object.fromEntries(
				LIFELINE_KEYS.map((key) => [key, draft.lifelines[key]])
			) as DailySopAssessment['lifelines']
		};
		const doc = makeDoc(
			DAILY_SOP_DOCUMENT_TYPE,
			DAILY_SOP_SCHEMA_VERSION,
			body,
			ctx,
			`${ctx.shelterCode}:${date}`
		) as DailySopAssessment;

		try {
			const saved = await putDocStrict(this.dbName, doc);
			return { kind: 'created', assessment: saved };
		} catch (error) {
			if (error instanceof ConflictError) {
				const existing = await this.read(doc._id);
				if (existing) return { kind: 'duplicate', assessment: existing };
			}
			throw error;
		}
	}

	async updateCompleted(
		existing: DailySopAssessment,
		draft: DailySopDraft,
		ctx: DailySopAuthorContext
	): Promise<DailySopAssessment> {
		if (ctx.shelterCode !== existing.shelter_code) {
			throw new Error('Daily SOP cannot be edited outside its shelter scope.');
		}
		const current = existing._rev ? existing : await this.read(existing._id);
		if (!current?._rev) throw new Error('Daily SOP snapshot revision is required for editing.');
		const timestamp = new Date().toISOString();
		const summary = summarizeDraft(draft);
		const updated: DailySopAssessment = {
			...existing,
			schema_v: DAILY_SOP_SCHEMA_VERSION,
			_rev: current._rev,
			progress_percent: summary.progressPercent,
			pass_percent: summary.passPercent,
			risk_label: summary.riskLabel,
			status: assessmentStatusFor(draft),
			controls: DAILY_SOP_QUESTIONS.map((question) => {
				const previous = existing.controls.find((control) => control.id === question.id);
				return {
					...controlSnapshotAudit(
						draft,
						question.id,
						previous?.checked_by ?? existing.assessor_name,
						previous?.checked_at ?? existing.assessed_at
					),
					id: question.id,
					section_id: question.sectionId,
					question: question.prompt,
					status: toStoredStatus(draft.controls[question.id]),
					answered:
						draft.answeredControls[question.id] === true ||
						draft.controls[question.id] !== 'Pending'
				};
			}),
			lifelines: Object.fromEntries(
				LIFELINE_KEYS.map((key) => [key, draft.lifelines[key]])
			) as DailySopAssessment['lifelines'],
			updated_at: timestamp
		};
		return putDocStrict(this.dbName, updated);
	}
}

function controlSnapshotAudit(
	draft: DailySopDraft,
	id: string,
	fallbackCheckedBy: string,
	fallbackCheckedAt: string
): { checked_by: string; checked_at: string } {
	const audit = draft.controlAudit[id];
	return {
		checked_by: audit?.checkedBy || fallbackCheckedBy,
		checked_at: audit?.checkedAt || fallbackCheckedAt
	};
}

let singleton: DailySopRemoteRepository | null = null;
let singletonDb: string | null = null;

export const dailySopRepository = (): DailySopRemoteRepository => {
	const db = getShelterDb();
	if (!singleton || singletonDb !== db) {
		singleton = new DailySopRemoteRepository(db);
		singletonDb = db;
	}
	return singleton;
};
