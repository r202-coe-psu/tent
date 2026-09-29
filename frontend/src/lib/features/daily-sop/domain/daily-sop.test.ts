import { describe, expect, it } from 'vitest';
import {
	DAILY_SOP_ROLES,
	assessableRoles,
	canAssessRole,
	canCompleteRoleDraft,
	classifyDailySopDocument,
	createEmptyRoleDraft,
	dailySopBangkokDate,
	dailySopReviewDates,
	metricForQuestion,
	promptForQuestion,
	questionsForRole,
	roleAssessmentProgress,
	summarizeRoleDraft
} from './daily-sop';
import { DAILY_SOP_ROLE_QUESTIONS } from './daily-sop.questions';
import { validRatios } from '$lib/features/sop-ratios/domain/sop-ratio.fixture';

describe('Daily SOP role question set', () => {
	it('uses the Bangkok calendar date rather than the browser UTC date', () => {
		expect(dailySopBangkokDate(new Date('2026-09-26T17:00:00.000Z'))).toBe('2026-09-27');
	});

	it('keeps today available even when no assessment has been saved yet', () => {
		expect(dailySopReviewDates([], '2026-09-29')).toEqual(['2026-09-29']);
	});

	it('lists saved dates once each, newest first, and includes today', () => {
		expect(
			dailySopReviewDates(['2026-09-25', '2026-09-27', '2026-09-25', '2026-09-29'], '2026-09-29')
		).toEqual(['2026-09-29', '2026-09-27', '2026-09-25']);
	});

	it('classifies records by their document type only', () => {
		expect(
			classifyDailySopDocument({ type: 'daily_sop_assessment', question_set_version: 'anything' })
		).toBe('legacy');
		expect(classifyDailySopDocument({ type: 'daily_sop_role_assessment' })).toBe('role');
		expect(classifyDailySopDocument({ type: 'other' })).toBe('unknown');
		expect(classifyDailySopDocument(null)).toBe('unknown');
		expect(questionsForRole('FAC')).toEqual(
			DAILY_SOP_ROLE_QUESTIONS.filter((question) => question.role === 'FAC')
		);
	});

	it('does not expose future dates, even if one appears in assessment history', () => {
		expect(dailySopReviewDates(['2026-09-28', '2026-09-30'], '2026-09-29')).toEqual([
			'2026-09-29',
			'2026-09-28'
		]);
	});

	it('contains unique questions for each of the nine roles', () => {
		expect(DAILY_SOP_ROLES).toHaveLength(9);
		expect(new Set(DAILY_SOP_ROLE_QUESTIONS.map((question) => question.id)).size).toBe(
			DAILY_SOP_ROLE_QUESTIONS.length
		);
		for (const role of DAILY_SOP_ROLES) {
			expect(questionsForRole(role.code).length).toBeGreaterThan(0);
		}
	});

	it('uses closed, plain-Thai questions and writes numeric parameters into the question', () => {
		expect(DAILY_SOP_ROLE_QUESTIONS.every((question) => question.prompt.endsWith('หรือไม่'))).toBe(
			true
		);
		expect(DAILY_SOP_ROLE_QUESTIONS.map((question) => question.prompt).join(' ')).not.toMatch(
			/\b(?:Parameter|PPE|REG|TRG)\b/
		);

		const parameterizedQuestionIds = [
			'D-VC-02',
			'D-FAC-01',
			'D-FAC-02',
			'D-FAC-03',
			'D-FAC-06',
			'D-FAC-07',
			'D-FAC-10'
		];
		for (const id of parameterizedQuestionIds) {
			const question = DAILY_SOP_ROLE_QUESTIONS.find((item) => item.id === id);
			const metric = metricForQuestion(id, validRatios);
			expect(question).toBeDefined();
			expect(metric?.parameter).toBeDefined();
			expect(promptForQuestion(question!, validRatios)).toContain(metric!.parameter!.value);
		}
		expect(
			promptForQuestion(
				DAILY_SOP_ROLE_QUESTIONS.find((item) => item.id === 'D-FAC-01')!,
				validRatios
			)
		).toContain('3.5 ตร.ม./คน');
	});

	it('keeps scoped permissions role-specific and lets the manager assess all roles', () => {
		expect(canAssessRole('REG', ['SH001:registration_staff'], 'SH001')).toBe(true);
		expect(canAssessRole('FAC', ['SH001:registration_staff'], 'SH001')).toBe(false);
		expect(canAssessRole('REG', ['SH002:registration_staff'], 'SH001')).toBe(false);
		expect(assessableRoles(['shelter_manager'], 'SH001')).toHaveLength(9);
		expect(assessableRoles(['system_admin'], 'SH001')).toHaveLength(9);
	});

	it('calculates numeric checks using their declared formula and leaves other checks manual', () => {
		const area = metricForQuestion('D-FAC-01', validRatios);
		expect(area?.evaluate({ usableArea: 350, occupants: 100 })).toBe(true);
		expect(area?.evaluate({ usableArea: 349.99, occupants: 100 })).toBe(false);
		expect(metricForQuestion('D-FAC-05')).toBeNull();
		expect(metricForQuestion('D-FAC-11', validRatios)).toBeNull();
		expect(promptForQuestion(questionsForRole('FAC')[10], validRatios)).toContain('อย่างปลอดภัย');
		const toilets = metricForQuestion('D-FAC-02', validRatios);
		expect(toilets?.evaluate({ people: 41, units: 3 })).toBe(true);
		expect(toilets?.evaluate({ people: 41, units: 2 })).toBe(false);
		expect(toilets?.threshold).toBe('20 คน/ห้อง');
		expect(promptForQuestion(questionsForRole('FAC')[1], validRatios)).toContain('20 คน/ห้อง');
	});

	it('uses the active parameter value instead of a fixed ratio', () => {
		expect(metricForQuestion('D-FAC-02')).toBeNull();
		const toilets = metricForQuestion('D-FAC-02', {
			...validRatios,
			people_per_toilet_female: '10'
		});
		expect(toilets?.threshold).toBe('10 คน/ห้อง');
		expect(toilets?.formula).toContain('÷ 10');
		expect(
			promptForQuestion(questionsForRole('FAC')[1], {
				...validRatios,
				people_per_toilet_female: '10'
			})
		).toContain('10 คน/ห้อง');
		expect(toilets?.evaluate({ people: 21, units: 3 })).toBe(true);
		expect(toilets?.evaluate({ people: 21, units: 2 })).toBe(false);
	});

	it('does not keep source references on role questions', () => {
		expect(DAILY_SOP_ROLE_QUESTIONS.every((question) => !('sourceRefs' in question))).toBe(true);
	});

	it('requires a status and notes for Fail/Pending before the role can complete', () => {
		const draft = createEmptyRoleDraft('REG');
		expect(roleAssessmentProgress(draft, 'REG')).toMatchObject({ unanswered: 10, percent: 0 });
		for (const question of questionsForRole('REG')) draft[question.id].status = 'Pass';
		expect(canCompleteRoleDraft(draft, 'REG')).toBe(true);
		draft['D-REG-01'].status = 'Fail';
		expect(canCompleteRoleDraft(draft, 'REG')).toBe(false);
		draft['D-REG-01'].notes = 'ป้ายทางเข้าหลุดจากจุดติดตั้ง';
		expect(canCompleteRoleDraft(draft, 'REG')).toBe(true);
		draft['D-REG-02'].status = 'Pending';
		expect(canCompleteRoleDraft(draft, 'REG')).toBe(false);
		draft['D-REG-02'].notes = 'รอยืนยันจำนวนผู้ช่วยจากผู้ประสานงาน';
		expect(summarizeRoleDraft(draft, 'REG')).toEqual({
			pass: 8,
			fail: 1,
			pending: 1,
			unanswered: 0
		});
	});
});
