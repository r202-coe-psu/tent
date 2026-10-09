import { describe, expect, it } from 'vitest';
import {
	DAILY_SOP_ROLE_QUESTION_COUNTS,
	DAILY_SOP_ROLE_QUESTION_IDS,
	DAILY_SOP_ROLE_QUESTION_VERSION,
	DAILY_SOP_ROLE_QUESTIONS
} from './daily-sop.questions';
import {
	DAILY_SOP_ROLES,
	assessableRoles,
	canAssessRole,
	canCompleteRoleDraft,
	classifyDailySopDocument,
	createEmptyRoleDraft,
	DAILY_SOP_ROLE_METRIC_CONTRACTS,
	dailySopBangkokDate,
	dailySopReviewDates,
	dailySopRoleAssessmentSchema,
	isDailySopUtcTimestamp,
	metricForQuestion,
	metricParameterForQuestion,
	questionText,
	requiredForMetric,
	requiredUnits,
	questionsForRole,
	roleAssessmentProgress,
	summarizeRoleDraft,
	type DailySopRoleAssessment,
	type DailySopRoleCode
} from './daily-sop';
import { SOP_RATIO_KEYS } from '$lib/features/sop-ratios/domain/sop-ratio';
import { validRatios } from '$lib/features/sop-ratios/domain/sop-ratio.fixture';

const timestamp = '2026-10-05T00:00:00.000Z';

function validAssessment(
	role: DailySopRoleCode,
	ratios: Partial<typeof validRatios> = validRatios
): DailySopRoleAssessment {
	const definition = DAILY_SOP_ROLES.find((item) => item.code === role)!;
	const controls = questionsForRole(role).map((question) => {
		const metric = metricForQuestion(question.id, ratios);
		return {
			id: question.id,
			question: questionText(question, ratios),
			metric_spec: metric
				? {
						fields: metric.fields,
						threshold: metric.threshold,
						...(metric.parameter ? { parameter: metric.parameter } : {})
					}
				: null,
			status: 'Pass' as const,
			notes: '',
			observations: '',
			measured_values: metric
				? Object.fromEntries(metric.fields.map((field) => [field.key, null]))
				: {},
			checked_by: 'staff-1',
			checked_by_name: 'ผู้ประเมิน',
			checked_at: timestamp
		};
	});
	const assessment: DailySopRoleAssessment = {
		_id: `daily_sop_role_assessment:SH001:2026-10-05:${role}`,
		type: 'daily_sop_role_assessment',
		schema_v: 1,
		shelter_code: 'SH001',
		assessment_date: '2026-10-05',
		role_code: role,
		role_key: definition.key,
		role_label: definition.label,
		question_set_version: DAILY_SOP_ROLE_QUESTION_VERSION,
		assessed_at: timestamp,
		assessor_name: 'ผู้ประเมิน',
		status: 'Completed',
		pass_count: controls.length,
		fail_count: 0,
		pending_count: 0,
		unanswered_count: 0,
		controls,
		created_at: timestamp,
		updated_at: timestamp,
		created_by: 'staff-1'
	};
	return assessment;
}

describe('Daily SOP role question set', () => {
	it('matches the CR v1 question bank exactly: 79 unique ordered IDs across nine roles', () => {
		expect(DAILY_SOP_ROLE_QUESTION_VERSION).toBe('daily-sop-role-v1');
		expect(DAILY_SOP_ROLE_QUESTIONS).toHaveLength(79);
		expect(DAILY_SOP_ROLES).toHaveLength(9);
		expect(new Set(DAILY_SOP_ROLE_QUESTIONS.map((question) => question.id)).size).toBe(79);
		for (const role of DAILY_SOP_ROLES) {
			const questions = questionsForRole(role.code);
			expect(questions).toHaveLength(DAILY_SOP_ROLE_QUESTION_COUNTS[role.code]);
			expect(questions.map((question) => question.id)).toEqual(
				DAILY_SOP_ROLE_QUESTION_IDS[role.code]
			);
			expect(questions.every((question) => question.role === role.code)).toBe(true);
		}
		expect(DAILY_SOP_ROLE_QUESTIONS.map((question) => question.id)).not.toContain('D-REG-04');
		expect(DAILY_SOP_ROLE_QUESTIONS.map((question) => question.role)).not.toContain('LEGACY');
		expect(DAILY_SOP_ROLE_QUESTIONS.find((question) => question.id === 'D-SM-03')?.text).toBe(
			'ข้อประเมินที่ไม่ผ่านของฝ่ายต่าง ๆ ที่กระทบความปลอดภัยหรือบริการจำเป็น มีผู้รับผิดชอบและแผนแก้ไขหรือไม่'
		);
		expect(DAILY_SOP_ROLE_QUESTIONS.find((question) => question.id === 'D-VC-01')?.text).toBe(
			'จำนวนอาสาสมัครที่มารายงานตัวและพร้อมปฏิบัติงานตรงกับบัญชีกำลังคนหรือไม่'
		);
	});

	it('registers only the CR numeric questions with valid units, steps, and SOP parameters', () => {
		const expectedMetricIds = [
			'D-SM-02',
			'D-REG-03',
			'D-TRG-01',
			'D-TRG-05',
			'D-TRG-08',
			'D-KS-06',
			'D-KS-10',
			'D-VC-01',
			'D-VC-02',
			'D-VC-03',
			'D-VC-04',
			'D-VC-05',
			'D-FAC-01',
			'D-FAC-02',
			'D-FAC-03',
			'D-FAC-06',
			'D-FAC-07',
			'D-FAC-08',
			'D-FAC-10'
		].sort();
		expect(Object.keys(DAILY_SOP_ROLE_METRIC_CONTRACTS).sort()).toEqual(expectedMetricIds);
		for (const id of expectedMetricIds) {
			const metric = metricForQuestion(id, validRatios);
			expect(metric).not.toBeNull();
			for (const item of metric!.fields) {
				expect(item.key.trim()).not.toBe('');
				expect(item.label.trim()).not.toBe('');
				expect(item.unit.trim()).not.toBe('');
				expect(Number(item.step)).toBeGreaterThan(0);
			}
			const parameterKey = metricParameterForQuestion(id);
			if (parameterKey) {
				expect(SOP_RATIO_KEYS).toContain(parameterKey);
				expect(Number(validRatios[parameterKey])).toBeGreaterThan(0);
				expect(metric?.parameter).toMatchObject({ key: parameterKey });
			}
		}
	});

	it('keeps calculations unavailable for missing operands, invalid ratios, and non-step values', () => {
		expect(metricForQuestion('D-SM-02')?.evaluate({ occupants: 1 })).toBeNull();
		expect(metricForQuestion('D-SM-02')?.evaluate({ occupants: 1, capacity: 0.5 })).toBeNull();
		expect(metricForQuestion('D-FAC-02', { people_per_toilet_female: '0' })).toBeNull();
		expect(metricForQuestion('D-FAC-02', { people_per_toilet_female: '9'.repeat(400) })).toBeNull();
	});

	it('uses the Bangkok date and excludes future assessment dates', () => {
		expect(dailySopBangkokDate(new Date('2026-09-30T16:59:59.000Z'))).toBe('2026-09-30');
		expect(dailySopBangkokDate(new Date('2026-09-30T17:00:00.000Z'))).toBe('2026-10-01');
		expect(dailySopReviewDates(['2026-09-28', '2026-09-30'], '2026-09-29')).toEqual([
			'2026-09-29',
			'2026-09-28'
		]);
	});

	it('accepts only real UTC Z timestamps for document audit fields', () => {
		expect(isDailySopUtcTimestamp('2026-10-05T17:00:00.000Z')).toBe(true);
		expect(isDailySopUtcTimestamp('2026-02-30T12:00:00Z')).toBe(false);
		expect(isDailySopUtcTimestamp('2026-10-05T25:00:00Z')).toBe(false);
		expect(isDailySopUtcTimestamp('2026-10-05T17:00:00+07:00')).toBe(false);
	});

	it('keeps read access separate from shelter-scoped write capabilities', () => {
		expect(canAssessRole('REG', ['SH001:registration_staff'], 'SH001')).toBe(true);
		expect(canAssessRole('FAC', ['SH001:registration_staff'], 'SH001')).toBe(false);
		expect(canAssessRole('REG', ['SH002:registration_staff'], 'SH001')).toBe(false);
		expect(canAssessRole('SC', ['SH001:warehouse_staff'], 'SH001')).toBe(true);
		expect(canAssessRole('SC', ['SH001:supply_coordinator'], 'SH001')).toBe(true);
		expect(canAssessRole('SC', ['warehouse_staff', 'shelter:SH001'], 'SH001')).toBe(true);
		expect(
			canAssessRole('SC', ['warehouse_staff', 'shelter:SH001', 'shelter:SH002'], 'SH001')
		).toBe(false);
		expect(assessableRoles(['SH001:shelter_manager'], 'SH001')).toHaveLength(9);
		expect(assessableRoles(['system_admin'], 'SH001')).toHaveLength(9);
	});

	it('calculates numeric context without choosing an evaluator status', () => {
		const draft = createEmptyRoleDraft('SM');
		expect(metricForQuestion('D-SM-02')?.evaluate({ occupants: 101, capacity: 100 })).toBe(false);
		expect(draft['D-SM-02'].status).toBeNull();
	});

	it('handles zero denominators, incomplete operands, ceilings, and decimal comparisons', () => {
		expect(metricForQuestion('D-REG-03')?.evaluate({ required: 0, complete: 0 })).toBe(true);
		expect(metricForQuestion('D-REG-03')?.evaluate({ required: 5, complete: 4 })).toBe(false);
		expect(
			metricForQuestion('D-KS-10')?.evaluate({ produced: 10, distributed: 2, loss: 1 })
		).toBeNull();
		expect(
			metricForQuestion('D-KS-10')?.evaluate({
				produced: 10,
				distributed: 2,
				loss: 1,
				remaining: 7
			})
		).toBe(true);
		expect(
			metricForQuestion('D-KS-10')?.evaluate({
				produced: 10,
				distributed: 2,
				loss: 1,
				remaining: 6
			})
		).toBe(false);
		expect(
			metricForQuestion('D-FAC-01', validRatios)?.evaluate({ usableArea: 0, occupants: 0 })
		).toBe(true);
		expect(
			metricForQuestion('D-FAC-01', validRatios)?.evaluate({ usableArea: 349.99, occupants: 100 })
		).toBe(false);
		expect(
			metricForQuestion('D-FAC-01', validRatios)?.evaluate({ usableArea: 350, occupants: 100 })
		).toBe(true);
		expect(
			metricForQuestion('D-FAC-02', { people_per_toilet_female: '2.5' })?.evaluate({
				people: 5,
				units: 2
			})
		).toBe(true);
		expect(
			metricForQuestion('D-FAC-02', { people_per_toilet_female: '2.5' })?.evaluate({
				people: 5,
				units: 1
			})
		).toBe(false);
	});

	it('requires an explicit Pending answer and note when a SOP parameter is missing', () => {
		const ratios = { ...validRatios, people_per_toilet_female: undefined };
		const question = questionsForRole('FAC').find((item) => item.id === 'D-FAC-02')!;
		expect(metricParameterForQuestion(question.id)).toBe('people_per_toilet_female');
		expect(metricForQuestion(question.id, ratios)).toBeNull();
		expect(questionText(question, ratios)).toContain('{people_per_toilet_female}');
		const assessment = validAssessment('FAC', ratios);
		const control = assessment.controls.find((item) => item.id === question.id)!;
		control.status = 'Pending';
		control.notes = 'ยังไม่มีค่า Parameter ของศูนย์';
		control.metric_spec = null;
		control.measured_values = {};
		assessment.pass_count--;
		assessment.pending_count++;
		expect(dailySopRoleAssessmentSchema.safeParse(assessment).success).toBe(true);
		control.status = 'Pass';
		assessment.pass_count++;
		assessment.pending_count--;
		expect(dailySopRoleAssessmentSchema.safeParse(assessment).success).toBe(false);
	});

	it('enforces exact schema snapshots, metrics, counters, and keeps Legacy classification separate', () => {
		const assessment = validAssessment('FAC');
		expect(dailySopRoleAssessmentSchema.safeParse(assessment).success).toBe(true);
		expect(classifyDailySopDocument({ type: 'daily_sop_assessment' })).toBe('legacy');
		expect(classifyDailySopDocument({ type: 'daily_sop_role_assessment' })).toBe('role');
		expect(classifyDailySopDocument({ type: 'unregistered' })).toBe('unknown');
		const invalidCount = { ...assessment, pass_count: assessment.pass_count - 1 };
		expect(dailySopRoleAssessmentSchema.safeParse(invalidCount).success).toBe(false);
		const invalidMetric = {
			...assessment,
			controls: assessment.controls.map((control) =>
				control.id === 'D-FAC-01' && control.metric_spec
					? {
							...control,
							metric_spec: {
								...control.metric_spec,
								fields: control.metric_spec.fields.map((field, index) =>
									index === 0 ? { ...field, step: '1' } : { ...field }
								)
							}
						}
					: control
			)
		};
		expect(dailySopRoleAssessmentSchema.safeParse(invalidMetric).success).toBe(false);
		const unexpectedField = { ...assessment, migrated_from: 'legacy' };
		expect(dailySopRoleAssessmentSchema.safeParse(unexpectedField).success).toBe(false);
	});

	it('requires notes for Fail and Pending before completing a role', () => {
		const draft = createEmptyRoleDraft('REG');
		expect(roleAssessmentProgress(draft, 'REG')).toMatchObject({
			total: 5,
			unanswered: 5,
			percent: 0
		});
		for (const question of questionsForRole('REG')) draft[question.id].status = 'Pass';
		expect(canCompleteRoleDraft(draft, 'REG')).toBe(true);
		draft['D-REG-01'].status = 'Fail';
		expect(canCompleteRoleDraft(draft, 'REG')).toBe(false);
		draft['D-REG-01'].notes = 'ป้ายทางเข้าหลุดจากจุดติดตั้ง';
		draft['D-REG-02'].status = 'Pending';
		draft['D-REG-02'].notes = 'รอยืนยันจำนวนผู้ช่วยจากผู้ประสานงาน';
		expect(canCompleteRoleDraft(draft, 'REG')).toBe(true);
		expect(summarizeRoleDraft(draft, 'REG')).toEqual({
			pass: 3,
			fail: 1,
			pending: 1,
			unanswered: 0
		});
	});
});

describe('CR-153 formulas and snapshot contract', () => {
	const cutIds = [
		'D-SM-01',
		'D-REG-04',
		'D-REG-05',
		'D-REG-06',
		'D-REG-07',
		'D-REG-09',
		'D-TRG-07',
		'D-MED-08',
		'D-KS-01',
		'D-KS-02',
		'D-KS-03',
		'D-KS-08'
	];

	it('keeps removed IDs out of the bank and avoids markdown code ticks in question text', () => {
		const ids = new Set<string>(DAILY_SOP_ROLE_QUESTIONS.map((question) => question.id));
		expect(DAILY_SOP_ROLE_QUESTIONS).toHaveLength(79);
		for (const id of cutIds) expect(ids.has(id)).toBe(false);
		for (const question of DAILY_SOP_ROLE_QUESTIONS) expect(question.text).not.toContain('`');
	});

	it('computes required units with ceil', () => {
		expect(requiredUnits(0, '2.5').toString()).toBe('0');
		expect(requiredUnits(5, '2.5').toString()).toBe('2');
		expect(requiredUnits(6, '2.5').toString()).toBe('3');
		const metric = metricForQuestion('D-FAC-02', { people_per_toilet_female: '2.5' });
		expect(requiredForMetric(metric, { people: 6 })).toEqual({ amount: '3', unit: 'ห้อง' });
		expect(requiredForMetric(metric, { people: null })).toBeNull();
		expect(requiredForMetric(metricForQuestion('D-SM-02'), { occupants: 6 })).toBeNull();
	});

	it.each([
		['D-KS-06', { required: 3, usable: 3 }, { required: 3, usable: 2 }],
		['D-VC-01', { rostered: 4, present: 4 }, { rostered: 4, present: 3 }],
		['D-TRG-01', { required: 0, complete: 0 }, { required: 2, complete: 1 }],
		['D-TRG-05', { required: 2, complete: 2 }, { required: 2, complete: 1 }],
		['D-TRG-08', { required: 0, complete: 0 }, { required: 0, complete: 1 }],
		['D-VC-03', { required: 2, complete: 2 }, { required: 2, complete: 1 }],
		['D-VC-04', { required: 2, complete: 2 }, { required: 2, complete: 1 }],
		['D-VC-05', { required: 2, complete: 2 }, { required: 2, complete: 1 }],
		['D-FAC-08', { available: 100.5, plannedNeed: 100.5 }, { available: 100.4, plannedNeed: 100.5 }]
	])('%s evaluates pass and fail operands', (id, pass, fail) => {
		const metric = metricForQuestion(id);
		if (!metric) throw new Error(`missing metric ${id}`);
		expect(metric.evaluate(pass)).toBe(true);
		expect(metric.evaluate(fail)).toBe(false);
	});

	it.each([
		['D-VC-02', 'volunteers', 'occupants', 'people_per_volunteer'],
		['D-FAC-03', 'units', 'people', 'people_per_toilet_male'],
		['D-FAC-06', 'units', 'people', 'people_per_bathing'],
		['D-FAC-07', 'units', 'people', 'people_per_laundry'],
		['D-FAC-10', 'units', 'people', 'people_per_tap']
	] as const)('%s ratio uses ceil and zero people', (id, unitKey, peopleKey, parameterKey) => {
		const ratios = { ...validRatios, [parameterKey]: '2.5' };
		const metric = metricForQuestion(id, ratios);
		if (!metric) throw new Error(`missing metric ${id}`);
		expect(metric.evaluate({ [peopleKey]: 0, [unitKey]: 0 })).toBe(true);
		expect(metric.evaluate({ [peopleKey]: 6, [unitKey]: 3 })).toBe(true);
		expect(metric.evaluate({ [peopleKey]: 6, [unitKey]: 2 })).toBe(false);
	});

	it('rejects negative values and values that miss the step', () => {
		expect(metricForQuestion('D-FAC-08')?.evaluate({ available: 0.05, plannedNeed: 0 })).toBeNull();
		expect(metricForQuestion('D-KS-06')?.evaluate({ required: 1.5, usable: 2 })).toBeNull();
		expect(
			metricForQuestion('D-FAC-01', validRatios)?.evaluate({ usableArea: 10.001, occupants: 1 })
		).toBeNull();
		expect(metricForQuestion('D-KS-06')?.evaluate({ required: -1, usable: 0 })).toBeNull();
	});

	it('rejects control question text that drifts from the bank', () => {
		const assessment = validAssessment('SM');
		assessment.controls[0].question += ' (แก้ไข)';
		expect(dailySopRoleAssessmentSchema.safeParse(assessment).success).toBe(false);
		const fac = validAssessment('FAC');
		const control = fac.controls.find((item) => item.id === 'D-FAC-02')!;
		control.question = 'แก้ไข {people_per_toilet_female}';
		control.status = 'Pending';
		control.notes = 'ไม่มีค่า';
		control.metric_spec = null;
		control.measured_values = {};
		fac.pass_count--;
		fac.pending_count++;
		expect(dailySopRoleAssessmentSchema.safeParse(fac).success).toBe(false);
	});

	it('enforces notes, version, id, role key and shape on the document', () => {
		const base = () => validAssessment('SM');
		const failNoNotes = base();
		failNoNotes.controls[0].status = 'Fail';
		failNoNotes.pass_count--;
		failNoNotes.fail_count++;
		for (const notes of ['', '   ']) {
			failNoNotes.controls[0].notes = notes;
			expect(dailySopRoleAssessmentSchema.safeParse(failNoNotes).success).toBe(false);
		}
		const noNotesKey = JSON.parse(JSON.stringify(failNoNotes));
		delete noNotesKey.controls[0].notes;
		expect(dailySopRoleAssessmentSchema.safeParse(noNotesKey).success).toBe(false);

		const nullVersion = { ...base(), question_set_version: null };
		expect(dailySopRoleAssessmentSchema.safeParse(nullVersion).success).toBe(false);
		const omitted: Record<string, unknown> = { ...base() };
		delete omitted.question_set_version;
		expect(dailySopRoleAssessmentSchema.safeParse(omitted).success).toBe(true);
		expect(
			dailySopRoleAssessmentSchema.safeParse({
				...base(),
				_id: 'daily_sop_role_assessment:SH001:x:SM'
			}).success
		).toBe(false);
		expect(
			dailySopRoleAssessmentSchema.safeParse({ ...base(), role_key: 'registration_staff' }).success
		).toBe(false);
		const extraControlField = base();
		(extraControlField.controls[0] as unknown as Record<string, unknown>).check_method = 'x';
		expect(dailySopRoleAssessmentSchema.safeParse(extraControlField).success).toBe(false);
		const strayParameter = base();
		strayParameter.controls[0].metric_spec = {
			fields: [{ key: 'a', label: 'a', unit: 'คน', step: '1' }],
			threshold: 'x'
		};
		expect(dailySopRoleAssessmentSchema.safeParse(strayParameter).success).toBe(false);
	});

	it('keeps D-SC-01 free of metrics and measured values', () => {
		const assessment = validAssessment('SC');
		const control = assessment.controls.find((item) => item.id === 'D-SC-01')!;
		expect(control.metric_spec).toBeNull();
		expect(control.measured_values).toEqual({});
		control.measured_values = { x: 1 };
		expect(dailySopRoleAssessmentSchema.safeParse(assessment).success).toBe(false);
	});
});
