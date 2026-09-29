import { z } from 'zod';
import { SOP_RATIO_KEYS, type SopRatioKey } from '$lib/features/sop-ratios/domain/sop-ratio';
import { DAILY_SOP_ROLE_QUESTIONS } from './daily-sop.questions';

export const DAILY_SOP_ROLE_DOCUMENT_TYPE = 'daily_sop_role_assessment' as const;
export const DAILY_SOP_ROLE_SCHEMA_VERSION = 1 as const;

export function classifyDailySopDocument(value: unknown): 'legacy' | 'role' | 'unknown' {
	if (!value || typeof value !== 'object') return 'unknown';
	const type = (value as { type?: unknown }).type;
	if (type === 'daily_sop_assessment') return 'legacy';
	return type === DAILY_SOP_ROLE_DOCUMENT_TYPE ? 'role' : 'unknown';
}

export const DAILY_SOP_ROLES = [
	{ code: 'SM', key: 'shelter_manager', label: 'ผู้จัดการศูนย์พักพิง' },
	{ code: 'REG', key: 'registration_staff', label: 'ลงทะเบียนและข้อมูลผู้พักพิง' },
	{ code: 'TRG', key: 'triage_staff', label: 'คัดกรองและกลุ่มเปราะบาง' },
	{ code: 'MED', key: 'medical_staff', label: 'การแพทย์และสุขภาพ' },
	{ code: 'KS', key: 'kitchen_staff', label: 'ครัวและโภชนาการ' },
	{ code: 'SC', key: 'supply_coordinator', label: 'คลัง พัสดุ และการแจกจ่าย' },
	{ code: 'VC', key: 'volunteer_coordinator', label: 'อาสาสมัครและกำลังคน' },
	{ code: 'SO', key: 'security_officer', label: 'ความปลอดภัย' },
	{ code: 'FAC', key: 'facility_staff', label: 'สถานที่ พื้นที่พัก และสาธารณูปโภค' }
] as const;

export type DailySopRoleCode = (typeof DAILY_SOP_ROLES)[number]['code'];
export type DailySopRoleKey = (typeof DAILY_SOP_ROLES)[number]['key'];
export type DailySopRoleStatus = 'Pass' | 'Fail' | 'Pending';
export type DailySopRoleAssessmentStatus = 'InProgress' | 'Completed';
export type DailySopRoleQuestion = (typeof DAILY_SOP_ROLE_QUESTIONS)[number];

export const dailySopBangkokDate = (date: Date = new Date()): string => {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Bangkok',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(date);
	const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
	return `${value.year}-${value.month}-${value.day}`;
};

export const dailySopReviewDates = (assessmentDates: readonly string[], today: string): string[] =>
	[...new Set([today, ...assessmentDates.filter((date) => date <= today)])].sort((a, b) =>
		b.localeCompare(a)
	);

export type MetricField = {
	key: string;
	label: string;
	unit: string;
	step?: string;
};

type MetricSpec = {
	fields: readonly MetricField[];
	formula: string;
	threshold: string;
	parameter?: { key: SopRatioKey; value: string };
	evaluate: (values: Readonly<Record<string, number | null>>) => boolean | null;
};

const value = (values: Readonly<Record<string, number | null>>, key: string) => {
	const item = values[key];
	return typeof item === 'number' && Number.isFinite(item) ? item : null;
};

const coverage = (
	values: Readonly<Record<string, number | null>>,
	required: string,
	done: string,
	percent = 100
) => {
	const total = value(values, required);
	const complete = value(values, done);
	if (total === null || complete === null || total < 0 || complete < 0) return null;
	if (complete > total) return false;
	return total === 0 ? complete === 0 : (complete / total) * 100 >= percent;
};

const metrics: Partial<Record<string, MetricSpec>> = {
	'D-SM-02': {
		fields: [
			{ key: 'occupants', label: 'จำนวนผู้พักพิงปัจจุบัน', unit: 'คน', step: '1' },
			{ key: 'capacity', label: 'ความจุที่ได้รับอนุมัติ', unit: 'คน', step: '1' }
		],
		formula: 'ผู้พักพิง ≤ ความจุที่ได้รับอนุมัติ',
		threshold: 'จำนวนผู้พักพิงไม่เกินความจุที่ได้รับอนุมัติ',
		evaluate: (v) => {
			const people = value(v, 'occupants');
			const capacity = value(v, 'capacity');
			return people === null || capacity === null || people < 0 || capacity < 0
				? null
				: people <= capacity;
		}
	},
	'D-REG-03': coverageMetric(
		'ผู้ที่ต้องได้รับความช่วยเหลือ',
		'ผู้ที่ได้รับความช่วยเหลือ',
		'จำนวนที่ช่วย ÷ จำนวนที่ต้องช่วย × 100 ≥ 100%',
		100
	),
	'D-REG-04': coverageMetric(
		'รายการลงทะเบียนใหม่ที่เข้าเกณฑ์',
		'รายการที่กรอกข้อมูลบังคับครบ',
		'รายการครบ ÷ รายการที่เข้าเกณฑ์ × 100 ≥ 100%',
		100
	),
	'D-TRG-01': coverageMetric(
		'ผู้พักพิงที่มาถึง',
		'ผู้ที่คัดกรองแล้ว',
		'คัดกรองแล้ว ÷ ผู้มาถึง × 100 = 100%',
		100
	),
	'D-TRG-05': coverageMetric(
		'ผู้พักพิงกลุ่มเสี่ยงที่ตรวจพบ',
		'รายการที่บันทึกประเภทและความต้องการครบ',
		'ข้อมูลครบ ÷ จำนวนที่ตรวจพบ × 100 = 100%',
		100
	),
	'D-TRG-08': coverageMetric(
		'รายการที่ต้องติดตามในรอบนี้',
		'รายการที่ติดตามแล้ว',
		'ติดตามแล้ว ÷ รายการที่ต้องติดตาม × 100 = 100%',
		100
	),
	'D-MED-08': coverageMetric(
		'เหตุที่เข้าเกณฑ์ส่งต่อ',
		'เหตุที่ส่งต่อภายใน 24 ชั่วโมง',
		'ส่งต่อภายใน 24 ชม. ÷ เหตุที่เข้าเกณฑ์ × 100 ≥ 90%',
		90
	),
	'D-KS-02': {
		fields: [
			{ key: 'planned', label: 'จำนวนอาหารตามแผนรอบนี้', unit: 'ที่', step: '1' },
			{ key: 'ready', label: 'จำนวนอาหารพร้อมแจก', unit: 'ที่', step: '1' }
		],
		formula: 'จำนวนอาหารพร้อมแจก ≥ จำนวนตามแผน',
		threshold: 'จำนวนอาหารพร้อมแจกไม่น้อยกว่าจำนวนตามแผน',
		evaluate: (v) => compare(v, 'ready', 'planned', '>=')
	},
	'D-KS-03': coverageMetric(
		'ผู้พักพิงที่ต้องการอาหารเฉพาะ',
		'ผู้ที่ได้รับอาหารตามความต้องการ',
		'ได้รับครบ ÷ ผู้ที่ต้องการ × 100 = 100%',
		100
	),
	'D-KS-06': {
		fields: [
			{ key: 'required', label: 'อุปกรณ์ที่ต้องใช้ในรอบนี้', unit: 'ชิ้น', step: '1' },
			{ key: 'usable', label: 'อุปกรณ์ที่สะอาดและใช้งานได้', unit: 'ชิ้น', step: '1' }
		],
		formula: 'อุปกรณ์ที่ใช้ได้ ≥ อุปกรณ์ที่ต้องใช้',
		threshold: 'จำนวนอุปกรณ์สะอาดและพร้อมใช้ไม่น้อยกว่าจำนวนที่ต้องใช้',
		evaluate: (v) => compare(v, 'usable', 'required', '>=')
	},
	'D-KS-10': {
		fields: [
			{ key: 'produced', label: 'ผลิต', unit: 'ที่', step: '1' },
			{ key: 'distributed', label: 'แจก', unit: 'ที่', step: '1' },
			{ key: 'loss', label: 'สูญเสีย', unit: 'ที่', step: '1' },
			{ key: 'remaining', label: 'คงเหลือจากการตรวจนับ', unit: 'ที่', step: '1' }
		],
		formula: 'ผลิต − แจก − สูญเสีย = คงเหลือ',
		threshold: 'ยอดผลิต − แจก − สูญเสีย เท่ากับยอดคงเหลือ',
		evaluate: (v) => {
			const produced = value(v, 'produced');
			const distributed = value(v, 'distributed');
			const loss = value(v, 'loss');
			const remaining = value(v, 'remaining');
			return [produced, distributed, loss, remaining].some((n) => n === null || n < 0)
				? null
				: Math.abs(produced! - distributed! - loss! - remaining!) < 0.000001;
		}
	},
	'D-SC-01': {
		fields: [
			{ key: 'opening', label: 'ยอดยกมา', unit: 'หน่วย', step: '0.01' },
			{ key: 'received', label: 'รับเข้า', unit: 'หน่วย', step: '0.01' },
			{ key: 'issued', label: 'จ่ายออก', unit: 'หน่วย', step: '0.01' },
			{ key: 'transferIn', label: 'โอนเข้า', unit: 'หน่วย', step: '0.01' },
			{ key: 'transferOut', label: 'โอนออก', unit: 'หน่วย', step: '0.01' },
			{ key: 'counted', label: 'ยอดตรวจนับจริง', unit: 'หน่วย', step: '0.01' }
		],
		formula: 'ยอดยกมา + รับเข้า − จ่ายออก + โอนเข้า − โอนออก = ยอดตรวจนับ',
		threshold: 'ยอดตามบัญชีตรงกับยอดตรวจนับ',
		evaluate: (v) => {
			const opening = value(v, 'opening');
			const received = value(v, 'received');
			const issued = value(v, 'issued');
			const transferIn = value(v, 'transferIn');
			const transferOut = value(v, 'transferOut');
			const counted = value(v, 'counted');
			const all = [opening, received, issued, transferIn, transferOut, counted];
			return all.some((n) => n === null || n < 0)
				? null
				: Math.abs(opening! + received! - issued! + transferIn! - transferOut! - counted!) <
						0.000001;
		}
	},
	'D-VC-01': {
		fields: [
			{ key: 'rostered', label: 'อาสาสมัครตามบัญชี/ตารางกะ', unit: 'คน', step: '1' },
			{ key: 'present', label: 'อาสาสมัครที่มาปฏิบัติงานจริง', unit: 'คน', step: '1' }
		],
		formula: 'ยอดตามบัญชี = ยอดมาปฏิบัติงานจริง หรือมีส่วนต่างพร้อมคำอธิบาย',
		threshold: 'เปรียบเทียบบัญชีกับการตรวจนับในรอบ',
		evaluate: (v) => compare(v, 'rostered', 'present', '===')
	},
	'D-VC-03': coverageMetric(
		'งานที่ต้องใช้ทักษะเฉพาะ',
		'งานที่มอบให้ผู้มีทักษะตรง',
		'งานที่จับคู่ทักษะตรง ÷ งานที่ต้องใช้ทักษะ × 100 = 100%',
		100
	),
	'D-VC-04': coverageMetric(
		'อาสาสมัครที่เริ่มงานในรอบนี้',
		'อาสาสมัครที่ผ่านการชี้แจง',
		'ผ่านการชี้แจง ÷ ผู้เริ่มงาน × 100 = 100%',
		100
	),
	'D-VC-05': coverageMetric(
		'ผู้ที่ได้รับมอบหมายงาน',
		'ผู้ที่มีคำสั่งงานและผู้ควบคุมครบ',
		'เอกสารครบ ÷ ผู้ได้รับมอบหมาย × 100 = 100%',
		100
	),
	'D-FAC-08': {
		fields: [
			{ key: 'available', label: 'น้ำปลอดภัยพร้อมใช้', unit: 'ลิตร', step: '0.1' },
			{ key: 'plannedNeed', label: 'ความต้องการตามแผนทรัพยากรวันนี้', unit: 'ลิตร', step: '0.1' }
		],
		formula: 'น้ำพร้อมใช้ ≥ ความต้องการตามแผนที่อนุมัติ',
		threshold: 'น้ำที่พร้อมใช้ไม่น้อยกว่าความต้องการตามแผนวันนี้',
		evaluate: (v) => compare(v, 'available', 'plannedNeed', '>=')
	}
};

function compare(
	v: Readonly<Record<string, number | null>>,
	left: string,
	right: string,
	op: '>=' | '<=' | '==='
) {
	const a = value(v, left);
	const b = value(v, right);
	if (a === null || b === null || a < 0 || b < 0) return null;
	if (op === '>=') return a >= b;
	if (op === '<=') return a <= b;
	return a === b;
}

function coverageMetric(
	labelA: string,
	labelB: string,
	formula: string,
	percent = 100
): MetricSpec {
	return {
		fields: [
			{ key: 'required', label: labelA, unit: 'รายการ', step: '1' },
			{ key: 'complete', label: labelB, unit: 'รายการ', step: '1' }
		],
		formula,
		threshold: `${percent}% ของรายการ`,
		evaluate: (v) => coverage(v, 'required', 'complete', percent)
	};
}

function ratioMetric(
	peopleKey: string,
	unitsKey: string,
	peopleLabel: string,
	unitsLabel: string,
	peoplePerUnit: number,
	unitLabel: string
): MetricSpec {
	return {
		fields: [
			{ key: peopleKey, label: peopleLabel, unit: 'คน', step: '1' },
			{ key: unitsKey, label: unitsLabel, unit: unitLabel, step: '1' }
		],
		formula: `${unitsLabel} ≥ ปัดขึ้น(${peopleLabel} ÷ ${peoplePerUnit})`,
		threshold: `${peoplePerUnit} คน/${unitLabel}`,
		evaluate: (v) => {
			const people = value(v, peopleKey);
			const units = value(v, unitsKey);
			return people === null || units === null || people < 0 || units < 0
				? null
				: units >= Math.ceil(people / peoplePerUnit);
		}
	};
}

const metricParameterKeys: Partial<Record<string, SopRatioKey>> = {
	'D-VC-02': 'people_per_volunteer',
	'D-FAC-01': 'm2_per_person_living',
	'D-FAC-02': 'people_per_toilet_female',
	'D-FAC-03': 'people_per_toilet_male',
	'D-FAC-06': 'people_per_bathing',
	'D-FAC-07': 'people_per_laundry',
	'D-FAC-10': 'people_per_tap'
};

export const metricParameterForQuestion = (questionId: string): SopRatioKey | null =>
	metricParameterKeys[questionId] ?? null;

export const metricForQuestion = (
	questionId: string,
	ratioValues?: Partial<Record<SopRatioKey, string>> | null
): MetricSpec | null => {
	const parameterKey = metricParameterForQuestion(questionId);
	if (!parameterKey) return metrics[questionId] ?? null;

	const rawParameter = ratioValues?.[parameterKey];
	const parameterValue = rawParameter === undefined ? Number.NaN : Number(rawParameter);
	if (!Number.isFinite(parameterValue) || parameterValue <= 0) return null;
	const withParameter = (metric: MetricSpec): MetricSpec => ({
		...metric,
		parameter: { key: parameterKey, value: rawParameter! }
	});

	switch (questionId) {
		case 'D-VC-02':
			return withParameter({
				fields: [
					{ key: 'occupants', label: 'จำนวนผู้พักพิง', unit: 'คน', step: '1' },
					{ key: 'volunteers', label: 'อาสาสมัครที่พร้อมปฏิบัติงาน', unit: 'คน', step: '1' }
				],
				formula: `อาสาสมัครพร้อม ≥ ปัดขึ้น(จำนวนผู้พักพิง ÷ ${parameterValue})`,
				threshold: `${parameterValue} ผู้พักพิง/อาสาสมัคร 1 คน`,
				evaluate: (v) => {
					const people = value(v, 'occupants');
					const volunteers = value(v, 'volunteers');
					return people === null || volunteers === null || people < 0 || volunteers < 0
						? null
						: volunteers >= Math.ceil(people / parameterValue);
				}
			});
		case 'D-FAC-01':
			return withParameter({
				fields: [
					{
						key: 'usableArea',
						label: 'พื้นที่พักอาศัยสุทธิที่ใช้ได้',
						unit: 'ตร.ม.',
						step: '0.01'
					},
					{ key: 'occupants', label: 'จำนวนผู้พักพิง', unit: 'คน', step: '1' }
				],
				formula: `พื้นที่สุทธิ ÷ ผู้พักพิง ≥ ${parameterValue} ตร.ม./คน`,
				threshold: `${parameterValue} ตร.ม./คน`,
				evaluate: (v) => {
					const area = value(v, 'usableArea');
					const people = value(v, 'occupants');
					return area === null || people === null || area < 0 || people < 0
						? null
						: people === 0
							? true
							: area / people >= parameterValue;
				}
			});
		case 'D-FAC-02':
			return withParameter(
				ratioMetric(
					'people',
					'units',
					'ผู้พักพิงหญิง',
					'ห้องน้ำหญิงที่ใช้งานได้',
					parameterValue,
					'ห้อง'
				)
			);
		case 'D-FAC-03':
			return withParameter(
				ratioMetric(
					'people',
					'units',
					'ผู้พักพิงชาย',
					'ห้องน้ำชายที่ใช้งานได้',
					parameterValue,
					'ห้อง'
				)
			);
		case 'D-FAC-06':
			return withParameter(
				ratioMetric('people', 'units', 'ผู้พักพิง', 'จุดอาบน้ำที่ใช้งานได้', parameterValue, 'จุด')
			);
		case 'D-FAC-07':
			return withParameter(
				ratioMetric('people', 'units', 'ผู้พักพิง', 'จุดซักล้างที่ใช้งานได้', parameterValue, 'จุด')
			);
		case 'D-FAC-10':
			return withParameter(
				ratioMetric('people', 'units', 'ผู้พักพิง', 'จุดจ่ายน้ำที่ใช้งานได้', parameterValue, 'จุด')
			);
	}
	return null;
};

export const promptForQuestion = (
	question: DailySopRoleQuestion,
	ratioValues?: Partial<Record<SopRatioKey, string>> | null
): string => {
	const metric = metricForQuestion(question.id, ratioValues);
	if (!metric) return question.prompt;

	switch (question.id) {
		case 'D-VC-02':
			return `มีอาสาสมัครพร้อมปฏิบัติงานอย่างน้อย 1 คนต่อผู้พักพิง ${metric.parameter?.value} คนหรือไม่`;
		case 'D-FAC-01':
			return `พื้นที่พักอาศัยสุทธิต่อผู้พักพิงไม่น้อยกว่า ${metric.threshold} หรือไม่`;
		case 'D-FAC-02':
			return `ห้องน้ำหญิงที่ใช้งานได้รองรับผู้พักพิงหญิงตามอัตราส่วนไม่เกิน ${metric.threshold} หรือไม่`;
		case 'D-FAC-03':
			return `ห้องน้ำชายที่ใช้งานได้รองรับผู้พักพิงชายตามอัตราส่วนไม่เกิน ${metric.threshold} หรือไม่`;
		case 'D-FAC-06':
			return `จุดอาบน้ำที่ใช้งานได้รองรับผู้พักพิงตามอัตราส่วนไม่เกิน ${metric.threshold} หรือไม่`;
		case 'D-FAC-07':
			return `จุดซักล้างที่ใช้งานได้รองรับผู้พักพิงตามอัตราส่วนไม่เกิน ${metric.threshold} หรือไม่`;
		case 'D-FAC-10':
			return `จุดจ่ายน้ำที่ใช้งานได้รองรับผู้พักพิงตามอัตราส่วนไม่เกิน ${metric.threshold} หรือไม่`;
		default:
			return question.prompt;
	}
};

export const questionsForRole = (role: DailySopRoleCode) =>
	DAILY_SOP_ROLE_QUESTIONS.filter((question) => question.role === role);

export const roleForCode = (code: string) =>
	DAILY_SOP_ROLES.find((role) => role.code === code) ?? null;

export const canAssessRole = (
	role: DailySopRoleCode,
	roles: readonly string[],
	shelterCode: string
) => {
	if (roles.includes('system_admin') || hasCapability('shelter_manager', roles, shelterCode))
		return true;
	const roleDefinition = roleForCode(role);
	return roleDefinition !== null && hasCapability(roleDefinition.key, roles, shelterCode);
};

export const assessableRoles = (roles: readonly string[], shelterCode: string) =>
	DAILY_SOP_ROLES.filter((role) => canAssessRole(role.code, roles, shelterCode));

function hasCapability(capability: string, roles: readonly string[], shelterCode: string) {
	return roles.includes(`${shelterCode}:${capability}`) || roles.includes(capability);
}

export interface DailySopRoleControlDraft {
	status: DailySopRoleStatus | null;
	notes: string;
	observations: string;
	measured_values: Record<string, number | null>;
}

export type DailySopRoleDraft = Record<string, DailySopRoleControlDraft>;

export interface DailySopRoleControlSnapshot extends DailySopRoleControlDraft {
	id: string;
	question: string;
	check_method: string;
	pass_criteria: string;
	record_values: string;
	metric_spec: {
		fields: readonly MetricField[];
		threshold?: string;
		parameter?: { key: SopRatioKey; value: string };
	} | null;
	checked_by: string;
	checked_by_name?: string;
	checked_at: string;
}

export interface DailySopRoleAssessment {
	_id: string;
	_rev?: string;
	type: typeof DAILY_SOP_ROLE_DOCUMENT_TYPE;
	schema_v: typeof DAILY_SOP_ROLE_SCHEMA_VERSION;
	shelter_code: string;
	assessment_date: string;
	role_code: DailySopRoleCode;
	role_key: DailySopRoleKey;
	role_label: string;
	question_set_version?: string;
	assessed_at: string;
	assessor_name: string;
	status: DailySopRoleAssessmentStatus;
	pass_count: number;
	fail_count: number;
	pending_count: number;
	unanswered_count: number;
	controls: DailySopRoleControlSnapshot[];
	created_at: string;
	updated_at: string;
	created_by: string;
}

export const createEmptyRoleDraft = (role: DailySopRoleCode): DailySopRoleDraft =>
	Object.fromEntries(
		questionsForRole(role).map((question) => [
			question.id,
			{
				status: null,
				notes: '',
				observations: '',
				measured_values: Object.fromEntries(
					(metricForQuestion(question.id)?.fields ?? []).map((field) => [field.key, null])
				)
			}
		])
	);

export const roleDraftFromAssessment = (assessment: DailySopRoleAssessment): DailySopRoleDraft =>
	Object.fromEntries(
		assessment.controls.map((control) => [
			control.id,
			{
				status: control.status,
				notes: control.notes,
				observations: control.observations,
				measured_values: { ...control.measured_values }
			}
		])
	);

const controlsForRoleDraft = (draft: DailySopRoleDraft, role: DailySopRoleCode) =>
	Object.entries(draft)
		.filter(([id]) => id.startsWith(`D-${role}-`))
		.map(([, control]) => control);

export const summarizeRoleDraft = (draft: DailySopRoleDraft, role: DailySopRoleCode) => {
	const controls = controlsForRoleDraft(draft, role);
	const counts = { pass: 0, fail: 0, pending: 0, unanswered: 0 };
	for (const control of controls) {
		if (!control?.status) counts.unanswered++;
		else if (control.status === 'Pass') counts.pass++;
		else if (control.status === 'Fail') counts.fail++;
		else counts.pending++;
	}
	return counts;
};

export const canCompleteRoleDraft = (draft: DailySopRoleDraft, role: DailySopRoleCode) =>
	controlsForRoleDraft(draft, role).every((control) => {
		return (
			Boolean(control?.status) && (control.status === 'Pass' || control.notes.trim().length > 0)
		);
	});

export const hasRoleDraftInput = (draft: DailySopRoleDraft, role: DailySopRoleCode) =>
	controlsForRoleDraft(draft, role).some((control) => {
		return (
			Boolean(control?.status || control?.notes.trim() || control?.observations.trim()) ||
			Object.values(control?.measured_values ?? {}).some((item) => item !== null)
		);
	});

export const roleAssessmentStatusFor = (
	draft: DailySopRoleDraft,
	role: DailySopRoleCode
): DailySopRoleAssessmentStatus => (canCompleteRoleDraft(draft, role) ? 'Completed' : 'InProgress');

export const roleAssessmentProgress = (draft: DailySopRoleDraft, role: DailySopRoleCode) => {
	const counts = summarizeRoleDraft(draft, role);
	const total = controlsForRoleDraft(draft, role).length;
	return {
		...counts,
		total,
		percent: total === 0 ? 0 : Math.round(((total - counts.unanswered) / total) * 100)
	};
};

const roleControlSchema = z
	.object({
		id: z.string().min(1),
		question: z.string().min(1),
		check_method: z.string().min(1),
		pass_criteria: z.string().min(1),
		record_values: z.string().min(1),
		metric_spec: z
			.object({
				fields: z
					.array(
						z.object({
							key: z.string().min(1),
							label: z.string().min(1),
							unit: z.string().min(1),
							step: z.string().optional()
						})
					)
					.min(1),
				threshold: z.string().min(1).optional(),
				parameter: z
					.object({
						key: z.enum(SOP_RATIO_KEYS),
						value: z.string().min(1)
					})
					.optional()
			})
			.nullable(),
		status: z.enum(['Pass', 'Fail', 'Pending']).nullable(),
		notes: z.string(),
		observations: z.string(),
		measured_values: z.record(z.string(), z.number().finite().min(0).nullable()),
		checked_by: z.string().min(1),
		checked_by_name: z.string().min(1).optional(),
		checked_at: z.string().min(1)
	})
	.passthrough()
	.superRefine((control, ctx) => {
		if ((control.status === 'Fail' || control.status === 'Pending') && !control.notes.trim()) {
			ctx.addIssue({
				code: 'custom',
				message: 'กรุณาระบุหมายเหตุเมื่อเลือกไม่ผ่านหรือรอตรวจ',
				path: ['notes']
			});
		}
	});

export const dailySopRoleAssessmentSchema = z
	.object({
		_id: z.string().min(1),
		type: z.literal(DAILY_SOP_ROLE_DOCUMENT_TYPE),
		schema_v: z.literal(DAILY_SOP_ROLE_SCHEMA_VERSION),
		shelter_code: z.string().min(1),
		assessment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		role_code: z.enum(
			DAILY_SOP_ROLES.map((role) => role.code) as [DailySopRoleCode, ...DailySopRoleCode[]]
		),
		role_key: z.enum(
			DAILY_SOP_ROLES.map((role) => role.key) as [DailySopRoleKey, ...DailySopRoleKey[]]
		),
		role_label: z.string().min(1),
		question_set_version: z.string().min(1).optional(),
		assessed_at: z.string().min(1),
		assessor_name: z.string().min(1),
		status: z.enum(['InProgress', 'Completed']),
		pass_count: z.number().int().min(0),
		fail_count: z.number().int().min(0),
		pending_count: z.number().int().min(0),
		unanswered_count: z.number().int().min(0),
		controls: z.array(roleControlSchema),
		created_at: z.string().min(1),
		updated_at: z.string().min(1),
		created_by: z.string().min(1)
	})
	.passthrough()
	.superRefine((assessment, ctx) => {
		const role = roleForCode(assessment.role_code);
		if (!role || assessment.role_key !== role.key || assessment.role_label !== role.label) {
			ctx.addIssue({
				code: 'custom',
				message: 'Daily SOP role identity does not match role code',
				path: ['role_code']
			});
			return;
		}
		const expectedId = `${DAILY_SOP_ROLE_DOCUMENT_TYPE}:${assessment.shelter_code}:${assessment.assessment_date}:${assessment.role_code}`;
		if (assessment._id !== expectedId) {
			ctx.addIssue({
				code: 'custom',
				message: 'Daily SOP role assessment id is invalid',
				path: ['_id']
			});
		}
		const counts = { pass: 0, fail: 0, pending: 0, unanswered: 0 };
		const controlIds = new Set<string>();
		assessment.controls.forEach((control, index) => {
			if (!control.id.startsWith(`D-${assessment.role_code}-`) || controlIds.has(control.id)) {
				ctx.addIssue({
					code: 'custom',
					message: 'Daily SOP role question id is invalid or duplicated',
					path: ['controls', index, 'id']
				});
			}
			controlIds.add(control.id);
			if (control.status === 'Pass') counts.pass++;
			else if (control.status === 'Fail') counts.fail++;
			else if (control.status === 'Pending') counts.pending++;
			else counts.unanswered++;
		});
		if (
			assessment.pass_count !== counts.pass ||
			assessment.fail_count !== counts.fail ||
			assessment.pending_count !== counts.pending ||
			assessment.unanswered_count !== counts.unanswered
		) {
			ctx.addIssue({
				code: 'custom',
				message: 'Daily SOP role summary does not match its answers',
				path: ['pass_count']
			});
		}
		if ((assessment.status === 'Completed') !== (counts.unanswered === 0)) {
			ctx.addIssue({
				code: 'custom',
				message: 'Daily SOP role status does not match answer completion',
				path: ['status']
			});
		}
	});

export const isDailySopRoleAssessment = (value: unknown): value is DailySopRoleAssessment =>
	classifyDailySopDocument(value) === 'role' &&
	dailySopRoleAssessmentSchema.safeParse(value).success;
