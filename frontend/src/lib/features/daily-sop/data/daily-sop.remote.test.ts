import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '$lib/utils/errors';
import {
	DAILY_SOP_QUESTIONS,
	LIFELINE_KEYS,
	answerControl,
	createEmptyDraft,
	type DailySopAssessment
} from '../domain/daily-sop';
import { buildDailySopId, DailySopRemoteRepository } from './daily-sop.remote';

const ctx = { shelterCode: 'SH001', createdBy: 'พนักงานประจำศูนย์ หาดใหญ่' };

vi.mock('$lib/db/couch-db', () => ({
	allDocsByType: vi.fn(),
	getDoc: vi.fn(),
	putDocStrict: vi.fn()
}));

describe('Daily SOP repository contract', () => {
	it('builds one deterministic id per shelter and date', () => {
		expect(buildDailySopId('SH001', '2026-06-11')).toBe('daily_sop_assessment:SH001:2026-06-11');
	});

	it('requires at least one selected status before writing', async () => {
		const repository = new DailySopRemoteRepository('shelter_sh001');
		await expect(repository.createCompleted(createEmptyDraft(), '2026-06-11', ctx)).rejects.toThrow(
			'at least one selected status'
		);
	});

	it('persists an in-progress record after the first selected answer', async () => {
		const couch = await import('$lib/db/couch-db');
		const draft = answerControl(
			createEmptyDraft(),
			'sop-reg-1',
			'Pending',
			ctx.createdBy,
			'2026-06-11T08:01:00.000Z'
		);
		vi.mocked(couch.putDocStrict).mockImplementationOnce(async (_db, doc) => doc);
		const result = await new DailySopRemoteRepository('shelter_sh001').createCompleted(
			draft,
			'2026-06-11',
			ctx
		);
		if (result.kind === 'created') {
			expect(result.assessment.schema_v).toBe(1);
			expect(result.assessment.status).toBe('InProgress');
			expect(result.assessment.controls[0]).toMatchObject({ status: 'Pending', answered: true });
			expect(result.assessment.controls[1].answered).toBe(false);
			expect(result.assessment.lifelines.electricity).toBeNull();
		}
	});

	it('returns the existing snapshot when CouchDB reports a duplicate', async () => {
		const couch = await import('$lib/db/couch-db');
		const draft = createEmptyDraft();
		DAILY_SOP_QUESTIONS.forEach((question) => (draft.controls[question.id] = 'Pass'));
		LIFELINE_KEYS.forEach((key) => (draft.lifelines[key] = 'Operational'));
		const existing = {
			_id: buildDailySopId('SH001', '2026-06-11'),
			type: 'daily_sop_assessment',
			schema_v: 1,
			shelter_code: 'SH001',
			assessment_date: '2026-06-11',
			assessed_at: '2026-06-11T15:00:00.000Z',
			assessor_name: ctx.createdBy,
			status: 'Completed',
			progress_percent: 100,
			pass_percent: 100,
			risk_label: 'ไม่พบความเสี่ยง',
			controls: DAILY_SOP_QUESTIONS.map((question) => ({
				id: question.id,
				section_id: question.sectionId,
				question: question.prompt,
				status: 'Yes',
				checked_by: ctx.createdBy,
				checked_at: '2026-06-11T15:00:00.000Z'
			})),
			lifelines: {
				electricity: 'Operational',
				water: 'Operational',
				gas: 'Operational',
				telecom: 'Operational'
			},
			created_at: '2026-06-11T15:00:00.000Z',
			updated_at: '2026-06-11T15:00:00.000Z',
			created_by: ctx.createdBy
		};
		vi.mocked(couch.putDocStrict).mockRejectedValueOnce(new ConflictError());
		vi.mocked(couch.getDoc).mockResolvedValueOnce(existing);
		const result = await new DailySopRemoteRepository('shelter_sh001').createCompleted(
			draft,
			'2026-06-11',
			ctx
		);
		expect(result.kind).toBe('duplicate');
		expect(result.assessment._id).toBe(existing._id);
	});

	it('persists explicitly selected Pending answers and non-operational Lifelines', async () => {
		const couch = await import('$lib/db/couch-db');
		const draft = createEmptyDraft();
		DAILY_SOP_QUESTIONS.forEach((question) => {
			draft.controls[question.id] = 'Pending';
			draft.answeredControls[question.id] = true;
		});
		LIFELINE_KEYS.forEach((key) => (draft.lifelines[key] = 'Interrupted'));
		vi.mocked(couch.putDocStrict).mockImplementationOnce(async (_db, doc) => ({
			...doc,
			_rev: '1-pending'
		}));

		const result = await new DailySopRemoteRepository('shelter_sh001').createCompleted(
			draft,
			'2026-06-12',
			ctx
		);
		expect(result.kind).toBe('created');
		if (result.kind === 'created') {
			expect(result.assessment.progress_percent).toBe(100);
			expect(result.assessment.pass_percent).toBe(0);
			expect(result.assessment.controls[0].status).toBe('Pending');
			expect(result.assessment.risk_label).toBe('พบความเสี่ยง');
		}
	});

	it('updates an existing snapshot with any control and lifeline status', async () => {
		const couch = await import('$lib/db/couch-db');
		const existing = {
			_id: buildDailySopId('SH001', '2026-06-11'),
			_rev: '3-revision',
			type: 'daily_sop_assessment',
			schema_v: 1,
			shelter_code: 'SH001',
			assessment_date: '2026-06-11',
			assessed_at: '2026-06-11T15:00:00.000Z',
			assessor_name: ctx.createdBy,
			status: 'Completed',
			progress_percent: 100,
			pass_percent: 100,
			risk_label: 'ไม่พบความเสี่ยง',
			controls: DAILY_SOP_QUESTIONS.map((question) => ({
				id: question.id,
				section_id: question.sectionId,
				question: question.prompt,
				status: 'Yes' as const,
				answered: true,
				checked_by: ctx.createdBy,
				checked_at: '2026-06-11T15:00:00.000Z'
			})),
			lifelines: {
				electricity: 'Operational' as const,
				water: 'Operational' as const,
				gas: 'Operational' as const,
				telecom: 'Operational' as const
			},
			created_at: '2026-06-11T15:00:00.000Z',
			updated_at: '2026-06-11T15:00:00.000Z',
			created_by: ctx.createdBy
		} satisfies DailySopAssessment;
		let draft = createEmptyDraft();
		draft = answerControl(
			draft,
			DAILY_SOP_QUESTIONS[0].id,
			'Fail',
			'staff01',
			'2026-08-31T12:11:00.000Z'
		);
		draft.lifelines.electricity = 'Critical';
		vi.mocked(couch.putDocStrict).mockImplementationOnce(async (_db, doc) => doc);

		const updated = await new DailySopRemoteRepository('shelter_sh001').updateCompleted(
			existing,
			draft,
			ctx
		);
		expect(updated._id).toBe(existing._id);
		expect(updated.schema_v).toBe(1);
		expect(updated._rev).toBe(existing._rev);
		expect(updated.assessed_at).toBe(existing.assessed_at);
		expect(updated.assessor_name).toBe(existing.assessor_name);
		expect(updated.created_at).toBe(existing.created_at);
		expect(updated.created_by).toBe(existing.created_by);
		expect(updated.controls[0].status).toBe('No');
		expect(updated.controls[0]).toMatchObject({
			checked_by: 'staff01',
			checked_at: '2026-08-31T12:11:00.000Z'
		});
		expect(updated.controls[1]).toMatchObject({
			checked_by: ctx.createdBy,
			checked_at: '2026-06-11T15:00:00.000Z'
		});
		expect(updated.lifelines.electricity).toBe('Critical');
		expect(couch.putDocStrict).toHaveBeenCalled();
	});
});
