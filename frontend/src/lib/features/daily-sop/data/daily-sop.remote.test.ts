import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createEmptyRoleDraft,
	dailySopBangkokDate,
	dailySopRoleAssessmentSchema,
	questionsForRole,
	roleDraftFromAssessment
} from '../domain/daily-sop';
import { buildDailySopRoleId, DailySopRoleRemoteRepository } from './daily-sop.remote';
import { validRatios } from '$lib/features/sop-ratios/domain/sop-ratio.fixture';

const ctx = {
	shelterCode: 'SH001',
	createdBy: 'fac01',
	assessorName: 'ผู้ตรวจสถานที่',
	roles: ['SH001:facility_staff'],
	sopRatios: validRatios
};

vi.mock('$lib/db/couch-db', () => ({
	allDocsByType: vi.fn(),
	getDoc: vi.fn(),
	putDocStrict: vi.fn()
}));

describe('Daily SOP role repository', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	beforeEach(async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-25T00:00:00.000Z'));
		const couch = await import('$lib/db/couch-db');
		vi.mocked(couch.allDocsByType).mockResolvedValue([]);
		vi.mocked(couch.getDoc).mockResolvedValue(null);
		vi.mocked(couch.putDocStrict).mockImplementation(async (_db, doc) => ({
			...doc,
			_rev: '1-created'
		}));
	});

	it('builds one deterministic assessment id for each shelter, day, and role', () => {
		expect(buildDailySopRoleId('SH001', '2026-09-25', 'FAC')).toBe(
			'daily_sop_role_assessment:SH001:2026-09-25:FAC'
		);
	});

	it('persists a role-specific snapshot with the active parameter threshold and no source references', async () => {
		const draft = createEmptyRoleDraft('FAC');
		for (const question of questionsForRole('FAC')) draft[question.id].status = 'Pass';
		draft['D-FAC-01'].measured_values = { usableArea: 350, occupants: 100 };
		const result = await new DailySopRoleRemoteRepository('shelter_sh001').createOrUpdate(
			'FAC',
			draft,
			'2026-09-25',
			ctx
		);
		expect(result._id).toBe(buildDailySopRoleId('SH001', '2026-09-25', 'FAC'));
		expect(result).not.toHaveProperty('question_set_version');
		expect(result.status).toBe('Completed');
		expect(result.controls).toHaveLength(15);
		expect(result.controls[0]).toMatchObject({
			id: 'D-FAC-01',
			question: 'พื้นที่พักอาศัยสุทธิต่อผู้พักพิงไม่น้อยกว่า 3.5 ตร.ม./คน หรือไม่',
			measured_values: { usableArea: 350, occupants: 100 },
			pass_criteria: 'พื้นที่สุทธิ ÷ ผู้พักพิง ≥ 3.5 ตร.ม./คน',
			metric_spec: {
				threshold: '3.5 ตร.ม./คน',
				parameter: { key: 'm2_per_person_living', value: '3.5' }
			}
		});
		expect(result.controls[0].metric_spec).not.toHaveProperty('formula');
		expect(result.controls[0]).not.toHaveProperty('source_refs');
		expect(result.created_by).toBe(ctx.createdBy);
		expect(result.assessor_name).toBe(ctx.assessorName);
		expect(result.controls[0].checked_by).toBe(ctx.createdBy);
		expect(result.controls[0].checked_by_name).toBe(ctx.assessorName);
		expect(result.controls[0].checked_at).toBe(result.assessed_at);

		const historicalCopy = dailySopRoleAssessmentSchema.parse({
			...result,
			question_set_version: 'daily-sop-role-v0',
			pass_count: result.pass_count - 1,
			unanswered_count: 0,
			controls: result.controls
				.slice(0, -1)
				.map((control, index) =>
					index === 0 ? { ...control, question: 'ถ้อยคำที่บันทึกไว้ตอนประเมิน' } : control
				)
		});
		expect(historicalCopy.controls[0].question).toBe('ถ้อยคำที่บันทึกไว้ตอนประเมิน');
		expect(historicalCopy.controls).toHaveLength(14);
		expect(historicalCopy.question_set_version).toBe('daily-sop-role-v0');
	});

	it('allows writes only for the current Bangkok date', async () => {
		const repo = new DailySopRoleRemoteRepository('shelter_sh001');
		const today = dailySopBangkokDate();
		const yesterday = new Date(`${today}T05:00:00.000Z`);
		yesterday.setUTCDate(yesterday.getUTCDate() - 1);
		const tomorrow = new Date(`${today}T05:00:00.000Z`);
		tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
		const dateValue = (value: Date) => value.toISOString().slice(0, 10);
		await expect(
			repo.createOrUpdate('FAC', createEmptyRoleDraft('FAC'), dateValue(yesterday), ctx)
		).rejects.toThrow('other dates are read-only');
		await expect(
			repo.createOrUpdate('FAC', createEmptyRoleDraft('FAC'), dateValue(tomorrow), ctx)
		).rejects.toThrow('other dates are read-only');
	});

	it('requires the role owner or manager and rejects Fail without a note', async () => {
		const repo = new DailySopRoleRemoteRepository('shelter_sh001');
		const draft = createEmptyRoleDraft('FAC');
		draft['D-FAC-01'].status = 'Fail';
		await expect(
			repo.createOrUpdate('FAC', draft, '2026-09-25', {
				shelterCode: 'SH001',
				createdBy: 'reg01',
				roles: ['SH001:registration_staff']
			})
		).rejects.toThrow('Unauthorized');
		await expect(repo.createOrUpdate('FAC', draft, '2026-09-25', ctx)).rejects.toThrow('notes');
	});

	it('updates answers without changing the saved question snapshot', async () => {
		const couch = await import('$lib/db/couch-db');
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-25T00:00:00.000Z'));
		const firstDraft = createEmptyRoleDraft('FAC');
		for (const question of questionsForRole('FAC')) firstDraft[question.id].status = 'Pass';
		const saved = await new DailySopRoleRemoteRepository('shelter_sh001').createOrUpdate(
			'FAC',
			firstDraft,
			'2026-09-25',
			ctx
		);
		const existing = {
			...saved,
			question_set_version: 'daily-sop-role-v0',
			pass_count: saved.pass_count - 1,
			controls: saved.controls
				.slice(0, -1)
				.map((control, index) =>
					index === 0 ? { ...control, question: 'ถ้อยคำเดิมของคำถาม' } : control
				),
			_rev: '2-current'
		};
		const draft = roleDraftFromAssessment(existing);
		const originalChangedAt = existing.controls.find(
			(control) => control.id === 'D-FAC-01'
		)!.checked_at;
		const originalUnchanged = existing.controls.find((control) => control.id === 'D-FAC-02')!;
		vi.mocked(couch.getDoc).mockResolvedValueOnce(existing);
		vi.mocked(couch.putDocStrict).mockImplementationOnce(async (_db, doc) => ({
			...doc,
			_rev: '3-updated'
		}));
		vi.setSystemTime(new Date('2026-09-25T03:00:00.000Z'));
		draft['D-FAC-01'].status = 'Fail';
		draft['D-FAC-01'].notes = 'พื้นที่บางส่วนใช้เป็นที่เก็บของ';
		const updated = await new DailySopRoleRemoteRepository('shelter_sh001').createOrUpdate(
			'FAC',
			draft,
			'2026-09-25',
			{
				shelterCode: 'SH001',
				createdBy: 'manager01',
				assessorName: 'ผู้จัดการรอบบ่าย',
				roles: ['SH001:shelter_manager'],
				sopRatios: validRatios
			}
		);
		expect(updated._id).toBe(existing._id);
		expect(updated._rev).toBe('3-updated');
		expect(updated.question_set_version).toBe('daily-sop-role-v0');
		expect(updated.controls).toHaveLength(14);
		expect(updated.controls[0].question).toBe('ถ้อยคำเดิมของคำถาม');
		expect(updated.fail_count).toBe(1);
		expect(updated.controls.find((control) => control.id === 'D-FAC-01')).toMatchObject({
			checked_by: 'manager01',
			checked_by_name: 'ผู้จัดการรอบบ่าย',
			checked_at: '2026-09-25T03:00:00.000Z'
		});
		expect(updated.controls.find((control) => control.id === 'D-FAC-01')!.checked_at).not.toBe(
			originalChangedAt
		);
		expect(updated.controls.find((control) => control.id === 'D-FAC-02')).toMatchObject({
			checked_by: ctx.createdBy,
			checked_by_name: ctx.assessorName,
			checked_at: originalUnchanged.checked_at
		});
	});
});
