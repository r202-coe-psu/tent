import Decimal from 'decimal.js';
import { z } from 'zod';
import { isSystemAdmin } from '$lib/auth/roles';
import { SOP_RATIO_KEYS, type SopRatioKey } from '$lib/features/sop-ratios/domain/sop-ratio';
import {
	DAILY_SOP_ROLE_QUESTION_IDS,
	DAILY_SOP_ROLE_QUESTION_VERSION,
	DAILY_SOP_ROLE_QUESTIONS
} from './daily-sop.questions';

export const DAILY_SOP_ROLE_DOCUMENT_TYPE = 'daily_sop_role_assessment' as const;
export const DAILY_SOP_ROLE_SCHEMA_VERSION = 1 as const;

export function classifyDailySopDocument(value: unknown): 'legacy' | 'role' | 'unknown' {
	if (!value || typeof value !== 'object') return 'unknown';
	const type = (value as { type?: unknown }).type;
	if (type === 'daily_sop_assessment') return 'legacy';
	return type === DAILY_SOP_ROLE_DOCUMENT_TYPE ? 'role' : 'unknown';
}

export const DAILY_SOP_ROLES = [
	{
		code: 'SM',
		key: 'shelter_manager',
		label: 'ผู้จัดการศูนย์พักพิง',
		capabilities: ['shelter_manager']
	},
	{
		code: 'REG',
		key: 'registration_staff',
		label: 'ลงทะเบียนและข้อมูลผู้พักพิง',
		capabilities: ['registration_staff']
	},
	{
		code: 'TRG',
		key: 'triage_staff',
		label: 'คัดกรองและกลุ่มเปราะบาง',
		capabilities: ['triage_staff']
	},
	{
		code: 'MED',
		key: 'medical_staff',
		label: 'การแพทย์และสุขภาพ',
		capabilities: ['medical_staff']
	},
	{ code: 'KS', key: 'kitchen_staff', label: 'ครัวและโภชนาการ', capabilities: ['kitchen_staff'] },
	{
		code: 'SC',
		key: 'supply_coordinator',
		label: 'คลัง พัสดุ และการแจกจ่าย',
		capabilities: ['supply_coordinator', 'warehouse_staff']
	},
	{
		code: 'VC',
		key: 'volunteer_coordinator',
		label: 'อาสาสมัครและกำลังคน',
		capabilities: ['volunteer_coordinator']
	},
	{ code: 'SO', key: 'security_officer', label: 'ความปลอดภัย', capabilities: ['security_officer'] },
	{
		code: 'FAC',
		key: 'facility_staff',
		label: 'สถานที่ พื้นที่พัก และสาธารณูปโภค',
		capabilities: ['facility_staff']
	}
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

export type MetricField = { key: string; label: string; unit: string; step: string };
type MetricValues = Readonly<Record<string, number | null | undefined>>;
type MetricDefinition = {
	fields: readonly MetricField[];
	threshold: string;
	/** UI-only result sentences (CR-153 ภาคผนวก B.2); never persisted in `metric_spec`. */
	passText: string;
	failText: string;
	/** UI-only explanation of the expected value, e.g. how much food should remain. */
	hint?: (values: MetricValues) => string | null;
	parameterKey?: SopRatioKey;
	evaluate: (values: MetricValues, parameter?: Decimal) => boolean | null;
};
export type MetricSpec = {
	fields: readonly MetricField[];
	threshold: string;
	passText: string;
	failText: string;
	hint: (values: MetricValues) => string | null;
	parameter?: { key: SopRatioKey; value: string };
	evaluate: (values: MetricValues) => boolean | null;
};

const field = (key: string, label: string, unit: string, step = '1'): MetricField => ({
	key,
	label,
	unit,
	step
});

const decimalValue = (values: MetricValues, key: string): Decimal | null => {
	const value = values[key];
	return typeof value === 'number' && Number.isFinite(value) ? new Decimal(String(value)) : null;
};

const compare = (
	values: MetricValues,
	left: string,
	right: string,
	operator: 'gte' | 'lte' | 'eq'
): boolean | null => {
	const a = decimalValue(values, left);
	const b = decimalValue(values, right);
	if (!a || !b || a.isNegative() || b.isNegative()) return null;
	return operator === 'gte' ? a.gte(b) : operator === 'lte' ? a.lte(b) : a.eq(b);
};

const equalCoverage = (values: MetricValues): boolean | null =>
	compare(values, 'complete', 'required', 'eq');

const metricDefinitions: Record<string, MetricDefinition> = {
	'D-SM-02': {
		fields: [
			field('occupants', 'ผู้พักพิงที่อยู่ในศูนย์ขณะนี้', 'คน'),
			field('capacity', 'จำนวนผู้พักพิงสูงสุดที่ศูนย์รองรับได้', 'คน')
		],
		passText: 'จำนวนผู้พักพิงไม่เกินที่ศูนย์รองรับได้',
		failText: 'จำนวนผู้พักพิงเกินที่ศูนย์รองรับได้',
		threshold: 'occupants ≤ capacity',
		evaluate: (values) => compare(values, 'occupants', 'capacity', 'lte')
	},
	'D-REG-03': {
		fields: [
			field('required', 'ผู้ที่ต้องการความช่วยเหลือในการลงทะเบียน', 'คน'),
			field('complete', 'ในจำนวนนี้ ได้รับความช่วยเหลือแล้ว', 'คน')
		],
		passText: 'ได้รับความช่วยเหลือครบทุกคนแล้ว',
		failText: 'ยังมีผู้ที่ไม่ได้รับความช่วยเหลือ',
		threshold: 'complete = required; ถ้า required = 0 ต้อง complete = 0',
		evaluate: equalCoverage
	},
	'D-TRG-01': {
		fields: [
			field('required', 'ผู้พักพิงที่มาถึงศูนย์', 'คน'),
			field('complete', 'ในจำนวนนี้ คัดกรองแล้ว', 'คน')
		],
		passText: 'คัดกรองครบทุกคนแล้ว',
		failText: 'ยังคัดกรองไม่ครบ',
		threshold: 'complete = required; ถ้า required = 0 ต้อง complete = 0',
		evaluate: equalCoverage
	},
	'D-TRG-05': {
		fields: [
			field('required', 'ผู้พักพิงกลุ่มเปราะบางที่พบ', 'คน'),
			field('complete', 'ในจำนวนนี้ บันทึกประเภทและความต้องการครบแล้ว', 'คน')
		],
		passText: 'บันทึกข้อมูลครบทุกคนแล้ว',
		failText: 'ยังบันทึกข้อมูลไม่ครบ',
		threshold: 'complete = required; ถ้า required = 0 ต้อง complete = 0',
		evaluate: equalCoverage
	},
	'D-TRG-08': {
		fields: [
			field('required', 'รายการติดตามที่ถึงกำหนด', 'รายการ'),
			field('complete', 'ในจำนวนนี้ ติดตามแล้ว', 'รายการ')
		],
		passText: 'ติดตามครบตามกำหนดแล้ว',
		failText: 'ยังมีรายการที่ไม่ได้ติดตาม',
		threshold: 'complete = required; ถ้า required = 0 ต้อง complete = 0',
		evaluate: equalCoverage
	},
	'D-KS-06': {
		fields: [
			field('required', 'จำนวนอุปกรณ์ที่ต้องใช้', 'ชิ้น'),
			field('usable', 'อุปกรณ์ที่สะอาดและใช้งานได้', 'ชิ้น')
		],
		passText: 'อุปกรณ์ที่พร้อมใช้มีเพียงพอ',
		failText: 'อุปกรณ์ที่พร้อมใช้ไม่เพียงพอ',
		threshold: 'usable ≥ required',
		evaluate: (values) => compare(values, 'usable', 'required', 'gte')
	},
	'D-KS-10': {
		fields: [
			field('produced', 'อาหารที่ทำเสร็จ', 'ที่'),
			field('distributed', 'อาหารที่แจกแล้ว', 'ที่'),
			field('loss', 'อาหารเสีย หก หรือทิ้ง', 'ที่'),
			field('remaining', 'อาหารที่เหลืออยู่จริง', 'ที่')
		],
		passText: 'ยอดอาหารคงเหลือตรงกับจำนวนที่ควรเหลือ',
		failText: 'ยอดอาหารคงเหลือไม่ตรงกับจำนวนที่ควรเหลือ',
		hint: (values) => {
			const produced = decimalValue(values, 'produced');
			const distributed = decimalValue(values, 'distributed');
			const loss = decimalValue(values, 'loss');
			if (!produced || !distributed || !loss) return null;
			const expected = produced.minus(distributed).minus(loss);
			return `ควรเหลือ ${expected.toString()} ที่ (ทำเสร็จ ${produced.toString()} − แจก ${distributed.toString()} − เสีย ${loss.toString()})`;
		},
		threshold: 'produced - distributed - loss = remaining',
		evaluate: (values) => {
			const produced = decimalValue(values, 'produced');
			const distributed = decimalValue(values, 'distributed');
			const loss = decimalValue(values, 'loss');
			const remaining = decimalValue(values, 'remaining');
			if ([produced, distributed, loss, remaining].some((item) => !item || item.isNegative()))
				return null;
			return produced!.minus(distributed!).minus(loss!).eq(remaining!);
		}
	},
	'D-VC-01': {
		fields: [
			field('rostered', 'จำนวนอาสาสมัครตามตารางกะ', 'คน'),
			field('present', 'จำนวนอาสาสมัครที่มาทำงานจริง', 'คน')
		],
		passText: 'จำนวนอาสาสมัครตรงตามตารางกะ',
		failText: 'จำนวนอาสาสมัครไม่ตรงตามตารางกะ',
		threshold:
			'จำนวนตรงกันเมื่อ present = rostered; ผู้ประเมินเลือก status เองและบันทึกเหตุผลใน notes เมื่อเกี่ยวข้อง',
		evaluate: (values) => compare(values, 'present', 'rostered', 'eq')
	},
	'D-VC-02': {
		fields: [
			field('occupants', 'ผู้พักพิงที่อยู่ในศูนย์ขณะนี้', 'คน'),
			field('volunteers', 'อาสาสมัครที่พร้อมทำงานขณะนี้', 'คน')
		],
		passText: 'จำนวนอาสาสมัครเพียงพอ',
		failText: 'จำนวนอาสาสมัครไม่เพียงพอ',
		threshold: 'volunteers ≥ ceil(occupants ÷ {parameter}); ถ้า occupants = 0 ต้องการ 0 คน',
		parameterKey: 'people_per_volunteer',
		evaluate: (values, parameter) => ratioCompare(values, 'occupants', 'volunteers', parameter)
	},
	'D-VC-03': {
		fields: [
			field('required', 'งานที่ต้องใช้ทักษะเฉพาะ', 'งาน'),
			field('complete', 'ในจำนวนนี้ มอบหมายให้ผู้มีทักษะตรงแล้ว', 'งาน')
		],
		passText: 'มอบหมายงานตรงทักษะครบแล้ว',
		failText: 'ยังมอบหมายงานตรงทักษะไม่ครบ',
		threshold: 'complete = required; ถ้า required = 0 ต้อง complete = 0',
		evaluate: equalCoverage
	},
	'D-VC-04': {
		fields: [
			field('required', 'อาสาสมัครที่เริ่มงาน', 'คน'),
			field('complete', 'ในจำนวนนี้ ได้รับคำชี้แจงแล้ว', 'คน')
		],
		passText: 'ชี้แจงครบทุกคนแล้ว',
		failText: 'ยังชี้แจงไม่ครบ',
		threshold: 'complete = required; ถ้า required = 0 ต้อง complete = 0',
		evaluate: equalCoverage
	},
	'D-VC-05': {
		fields: [
			field('required', 'อาสาสมัครที่ได้รับมอบหมายงาน', 'คน'),
			field('complete', 'ในจำนวนนี้ มีคำสั่งงานและผู้ควบคุมแล้ว', 'คน')
		],
		passText: 'มีคำสั่งงานและผู้ควบคุมครบทุกคน',
		failText: 'ยังมีผู้ที่ไม่มีคำสั่งงานหรือผู้ควบคุม',
		threshold: 'complete = required; ถ้า required = 0 ต้อง complete = 0',
		evaluate: equalCoverage
	},
	'D-FAC-01': {
		fields: [
			field('usableArea', 'พื้นที่นอนพักที่ใช้ได้จริง', 'ตร.ม.', '0.01'),
			field('occupants', 'ผู้พักพิงที่อยู่ในศูนย์ขณะนี้', 'คน')
		],
		passText: 'พื้นที่นอนพักเพียงพอตามเกณฑ์',
		failText: 'พื้นที่นอนพักไม่เพียงพอ',
		threshold:
			'ถ้า occupants > 0: usableArea ÷ occupants ≥ {parameter}; ถ้า occupants = 0 ให้พื้นที่ขั้นต่ำเป็น 0 ตร.ม.',
		parameterKey: 'm2_per_person_living',
		evaluate: (values, parameter) => {
			const area = decimalValue(values, 'usableArea');
			const people = decimalValue(values, 'occupants');
			if (!area || !people || area.isNegative() || people.isNegative() || !parameter) return null;
			return people.isZero() ? area.gte(0) : area.gte(people.times(parameter));
		}
	},
	'D-FAC-02': {
		fields: [
			field('people', 'ผู้พักพิงหญิง', 'คน'),
			field('units', 'ห้องน้ำหญิงที่ใช้ได้จริง', 'ห้อง')
		],
		passText: 'ห้องน้ำหญิงเพียงพอตามเกณฑ์',
		failText: 'ห้องน้ำหญิงไม่เพียงพอ',
		threshold: 'units ≥ ceil(people ÷ {parameter}); ถ้า people = 0 ต้องการ 0 ห้อง',
		parameterKey: 'people_per_toilet_female',
		evaluate: (values, parameter) => ratioCompare(values, 'people', 'units', parameter)
	},
	'D-FAC-03': {
		fields: [
			field('people', 'ผู้พักพิงชาย', 'คน'),
			field('units', 'ห้องน้ำชายที่ใช้ได้จริง', 'ห้อง')
		],
		passText: 'ห้องน้ำชายเพียงพอตามเกณฑ์',
		failText: 'ห้องน้ำชายไม่เพียงพอ',
		threshold: 'units ≥ ceil(people ÷ {parameter}); ถ้า people = 0 ต้องการ 0 ห้อง',
		parameterKey: 'people_per_toilet_male',
		evaluate: (values, parameter) => ratioCompare(values, 'people', 'units', parameter)
	},
	'D-FAC-06': {
		fields: [
			field('people', 'ผู้พักพิงที่อยู่ในศูนย์ขณะนี้', 'คน'),
			field('units', 'จุดอาบน้ำที่ใช้ได้จริง', 'จุด')
		],
		passText: 'จุดอาบน้ำเพียงพอตามเกณฑ์',
		failText: 'จุดอาบน้ำไม่เพียงพอ',
		threshold: 'units ≥ ceil(people ÷ {parameter}); ถ้า people = 0 ต้องการ 0 จุด',
		parameterKey: 'people_per_bathing',
		evaluate: (values, parameter) => ratioCompare(values, 'people', 'units', parameter)
	},
	'D-FAC-07': {
		fields: [
			field('people', 'ผู้พักพิงที่อยู่ในศูนย์ขณะนี้', 'คน'),
			field('units', 'จุดซักล้างที่ใช้ได้จริง', 'จุด')
		],
		passText: 'จุดซักล้างเพียงพอตามเกณฑ์',
		failText: 'จุดซักล้างไม่เพียงพอ',
		threshold: 'units ≥ ceil(people ÷ {parameter}); ถ้า people = 0 ต้องการ 0 จุด',
		parameterKey: 'people_per_laundry',
		evaluate: (values, parameter) => ratioCompare(values, 'people', 'units', parameter)
	},
	'D-FAC-08': {
		fields: [
			field('available', 'น้ำสะอาดที่มีพร้อมใช้', 'ลิตร', '0.1'),
			field('plannedNeed', 'ปริมาณน้ำที่ศูนย์วางแผนว่าจะใช้วันนี้', 'ลิตร', '0.1')
		],
		passText: 'มีน้ำสะอาดเพียงพอตามแผน',
		failText: 'น้ำสะอาดไม่เพียงพอตามแผน',
		threshold: 'available ≥ plannedNeed',
		evaluate: (values) => compare(values, 'available', 'plannedNeed', 'gte')
	},
	'D-FAC-10': {
		fields: [
			field('people', 'ผู้พักพิงที่อยู่ในศูนย์ขณะนี้', 'คน'),
			field('units', 'จุดจ่ายน้ำที่ใช้ได้จริง', 'จุด')
		],
		passText: 'จุดจ่ายน้ำเพียงพอตามเกณฑ์',
		failText: 'จุดจ่ายน้ำไม่เพียงพอ',
		threshold: 'units ≥ ceil(people ÷ {parameter}); ถ้า people = 0 ต้องการ 0 จุด',
		parameterKey: 'people_per_tap',
		evaluate: (values, parameter) => ratioCompare(values, 'people', 'units', parameter)
	}
};

function ratioCompare(
	values: MetricValues,
	peopleKey: string,
	unitKey: string,
	parameter?: Decimal
): boolean | null {
	const people = decimalValue(values, peopleKey);
	const units = decimalValue(values, unitKey);
	if (!people || !units || people.isNegative() || units.isNegative() || !parameter) return null;
	return units.gte(requiredUnits(people, parameter));
}

export function requiredUnits(people: Decimal.Value, parameter: Decimal.Value): Decimal {
	return new Decimal(people).div(parameter).ceil();
}

export const DAILY_SOP_ROLE_METRIC_CONTRACTS = Object.fromEntries(
	Object.entries(metricDefinitions).map(([id, definition]) => [
		id,
		{
			fields: definition.fields,
			threshold: definition.threshold,
			...(definition.parameterKey ? { parameterKey: definition.parameterKey } : {})
		}
	])
) as Record<
	string,
	{ fields: readonly MetricField[]; threshold: string; parameterKey?: SopRatioKey }
>;

const isPositiveDecimalString = (value: string | undefined): value is string =>
	typeof value === 'string' &&
	/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) &&
	Number.isFinite(Number(value)) &&
	Number(value) > 0 &&
	new Decimal(value).gt(0);

const isStepAligned = (value: number, step: string): boolean => {
	try {
		const amount = new Decimal(String(value));
		const increment = new Decimal(step);
		return (
			amount.isFinite() && increment.isFinite() && increment.gt(0) && amount.mod(increment).isZero()
		);
	} catch {
		return false;
	}
};

const thresholdFor = (definition: MetricDefinition, parameterValue?: string) =>
	definition.parameterKey
		? definition.threshold.replace('{parameter}', parameterValue ?? `{${definition.parameterKey}}`)
		: definition.threshold;

export const metricParameterForQuestion = (questionId: string): SopRatioKey | null =>
	metricDefinitions[questionId]?.parameterKey ?? null;

export const metricForQuestion = (
	questionId: string,
	ratioValues?: Partial<Record<SopRatioKey, string>> | null
): MetricSpec | null => {
	const definition = metricDefinitions[questionId];
	if (!definition) return null;
	const parameterKey = definition.parameterKey;
	const parameterValue = parameterKey ? ratioValues?.[parameterKey] : undefined;
	const validParameter = isPositiveDecimalString(parameterValue) ? parameterValue : undefined;
	if (parameterKey && !validParameter) return null;
	const parameter = validParameter ? new Decimal(validParameter) : undefined;
	return {
		fields: definition.fields,
		threshold: thresholdFor(definition, validParameter),
		passText: definition.passText,
		failText: definition.failText,
		hint: (values) => definition.hint?.(values) ?? null,
		...(parameterKey && validParameter
			? { parameter: { key: parameterKey, value: validParameter } }
			: {}),
		evaluate: (values) => {
			if (
				definition.fields.some((item) => {
					const measured = values[item.key];
					return measured !== null && measured !== undefined && !isStepAligned(measured, item.step);
				})
			)
				return null;
			return definition.evaluate(values, parameter);
		}
	};
};

export const requiredForMetric = (
	metric: MetricSpec | null,
	values: MetricValues
): { amount: string; unit: string } | null => {
	if (!metric?.parameter) return null;
	const pairs = [
		['people', 'units'],
		['occupants', 'volunteers']
	] as const;
	for (const [peopleKey, unitKey] of pairs) {
		const target = metric.fields.find((item) => item.key === unitKey);
		const people = values[peopleKey];
		if (!target || people === null || people === undefined || people < 0) continue;
		return {
			amount: requiredUnits(people, metric.parameter.value).toString(),
			unit: target.unit
		};
	}
	return null;
};

export const questionText = (
	question: DailySopRoleQuestion,
	ratioValues?: Partial<Record<SopRatioKey, string>> | null
): string => {
	const parameterKey = metricParameterForQuestion(question.id);
	if (!parameterKey) return question.text;
	const parameter = ratioValues?.[parameterKey];
	return isPositiveDecimalString(parameter)
		? question.text.replace(`{${parameterKey}}`, parameter)
		: question.text;
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
	if (isSystemAdmin(roles) || hasCapability('shelter_manager', roles, shelterCode)) return true;
	const roleDefinition = roleForCode(role);
	return (
		roleDefinition?.capabilities.some((capability) =>
			hasCapability(capability, roles, shelterCode)
		) ?? false
	);
};

/** Rows the UI may show (CR-153): only roles the user can assess, in the canonical 9-role order. */
export const roleRowAccess = (availableRoles: readonly { code: DailySopRoleCode }[]) =>
	DAILY_SOP_ROLES.filter((role) =>
		availableRoles.some((availableRole) => availableRole.code === role.code)
	).map((role) => ({ role, canAssess: true }));

/**
 * Dates the day list may show (CR-153 History contract): dates that have a document for a
 * visible role, plus today when the user has at least one visible role.
 */
export const visibleHistoryDates = (
	assessments: readonly { assessment_date: string; role_code: DailySopRoleCode }[],
	visibleRoles: readonly { code: DailySopRoleCode }[],
	today: string
): string[] => {
	if (visibleRoles.length === 0) return [];
	const visible = new Set(visibleRoles.map((role) => role.code));
	return dailySopReviewDates(
		assessments.filter((item) => visible.has(item.role_code)).map((item) => item.assessment_date),
		today
	);
};

/** True while the loaded pages hold no visible-role document but more pages exist. */
export const historyNeedsMorePages = (
	assessments: readonly { role_code: DailySopRoleCode }[],
	visibleRoles: readonly { code: DailySopRoleCode }[],
	hasNextPage: boolean
): boolean =>
	hasNextPage &&
	!assessments.some((item) => visibleRoles.some((role) => role.code === item.role_code));

/** Questions whose numbers the page can pre-fill from live shelter data. */
export const DAILY_SOP_OCCUPANCY_QUESTION_IDS: readonly string[] = [
	'D-SM-02',
	'D-VC-02',
	'D-FAC-01'
];
export const DAILY_SOP_CAPACITY_QUESTION_ID = 'D-SM-02';
export const DAILY_SOP_STOCK_QUESTION_ID = 'D-SC-01';

const roleHasQuestion = (role: DailySopRoleCode, questionIds: readonly string[]) =>
	questionsForRole(role).some((question) => questionIds.includes(question.id));

export const roleUsesOccupancy = (role: DailySopRoleCode) =>
	roleHasQuestion(role, DAILY_SOP_OCCUPANCY_QUESTION_IDS);
export const roleUsesShelterCapacity = (role: DailySopRoleCode) =>
	roleHasQuestion(role, [DAILY_SOP_CAPACITY_QUESTION_ID]);
export const roleUsesStockCheck = (role: DailySopRoleCode) =>
	roleHasQuestion(role, [DAILY_SOP_STOCK_QUESTION_ID]);

/** Drops the trailing account name, e.g. "พว. สมหญิง (Staff 02)" → "พว. สมหญิง". */
export const personDisplayName = (name: string | undefined): string =>
	(name ?? '').replace(/\s*\([^)]*\)\s*$/, '');

export const daySummaryStatus = (day: {
	recordedRoles: number;
	completedRoles: number;
	roleCount: number;
}): 'Completed' | 'InProgress' | undefined =>
	day.recordedRoles === 0
		? undefined
		: day.completedRoles === day.roleCount
			? 'Completed'
			: 'InProgress';

export const assessableRoles = (roles: readonly string[], shelterCode: string) =>
	DAILY_SOP_ROLES.filter((role) => canAssessRole(role.code, roles, shelterCode));

function hasCapability(capability: string, roles: readonly string[], shelterCode: string) {
	if (roles.includes(`${shelterCode}:${capability}`)) return true;
	const scopes = roles.filter((role) => /^shelter:[^:]+$/.test(role));
	return (
		roles.includes(capability) && scopes.length === 1 && scopes[0] === `shelter:${shelterCode}`
	);
}

export interface DailySopRoleControlDraft {
	status: DailySopRoleStatus | null;
	notes: string;
	observations: string;
	measured_values: Record<string, number | null>;
}

export type DailySopRoleDraft = Record<string, DailySopRoleControlDraft>;
export type DailySopSystemMetricSuggestions = Readonly<
	Record<string, Readonly<Record<string, number>>>
>;

export interface DailySopRoleControlSnapshot extends DailySopRoleControlDraft {
	id: string;
	question: string;
	metric_spec: {
		fields: readonly MetricField[];
		threshold: string;
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
	question_set_version?: typeof DAILY_SOP_ROLE_QUESTION_VERSION;
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
					(metricForQuestion(question.id)?.fields ?? []).map((item) => [item.key, null])
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
	questionsForRole(role).map((question) => draft[question.id]);

export const summarizeRoleDraft = (draft: DailySopRoleDraft, role: DailySopRoleCode) => {
	const counts = { pass: 0, fail: 0, pending: 0, unanswered: 0 };
	for (const control of controlsForRoleDraft(draft, role)) {
		if (!control?.status) counts.unanswered++;
		else if (control.status === 'Pass') counts.pass++;
		else if (control.status === 'Fail') counts.fail++;
		else counts.pending++;
	}
	return counts;
};

const ANSWERED_STATUSES: ReadonlySet<unknown> = new Set(['Pass', 'Fail', 'Pending']);

export const isAnsweredStatus = (status: unknown): status is DailySopRoleStatus =>
	ANSWERED_STATUSES.has(status);

/** CR-153: only Pending requires notes; Pass and Fail may leave notes empty. */
export const notesRequired = (status: DailySopRoleStatus | null | undefined): boolean =>
	status === 'Pending';

export const isControlComplete = (
	control: Pick<DailySopRoleControlDraft, 'status' | 'notes'> | undefined
): boolean => {
	if (!control || !isAnsweredStatus(control.status)) return false;
	return !notesRequired(control.status) || control.notes.trim().length > 0;
};

export const canCompleteRoleDraft = (draft: DailySopRoleDraft, role: DailySopRoleCode) =>
	controlsForRoleDraft(draft, role).every(isControlComplete);

export const hasRoleDraftInput = (draft: DailySopRoleDraft, role: DailySopRoleCode) =>
	controlsForRoleDraft(draft, role).some(
		(control) =>
			Boolean(control?.status || control?.notes.trim() || control?.observations.trim()) ||
			Object.values(control?.measured_values ?? {}).some((item) => item !== null)
	);

export const applySystemMetricSuggestionsForEditedControls = (
	draft: DailySopRoleDraft,
	baseDraft: DailySopRoleDraft,
	role: DailySopRoleCode,
	suggestions: DailySopSystemMetricSuggestions,
	sopRatios?: Partial<Record<SopRatioKey, string>>
): DailySopRoleDraft => {
	const result = Object.fromEntries(
		Object.entries(draft).map(([id, answer]) => [
			id,
			{ ...answer, measured_values: { ...answer.measured_values } }
		])
	);
	for (const question of questionsForRole(role)) {
		const answer = result[question.id];
		const baseAnswer = baseDraft[question.id];
		if (!answer || !baseAnswer) continue;
		const measuredKeys = new Set([
			...Object.keys(answer.measured_values),
			...Object.keys(baseAnswer.measured_values)
		]);
		const changed =
			answer.status !== baseAnswer.status ||
			answer.notes !== baseAnswer.notes ||
			answer.observations !== baseAnswer.observations ||
			[...measuredKeys].some(
				(key) => answer.measured_values[key] !== baseAnswer.measured_values[key]
			);
		if (!changed) continue;
		const metricKeys = new Set([
			...Object.keys(answer.measured_values),
			...(metricForQuestion(question.id, sopRatios)?.fields.map((item) => item.key) ?? [])
		]);
		for (const [key, value] of Object.entries(suggestions[question.id] ?? {})) {
			if (
				metricKeys.has(key) &&
				(answer.measured_values[key] === null || answer.measured_values[key] === undefined)
			)
				answer.measured_values[key] = value;
		}
	}
	return result;
};

export const roleAssessmentStatusFor = (
	draft: DailySopRoleDraft,
	role: DailySopRoleCode
): DailySopRoleAssessmentStatus => (canCompleteRoleDraft(draft, role) ? 'Completed' : 'InProgress');

export const roleAssessmentProgress = (draft: DailySopRoleDraft, role: DailySopRoleCode) => {
	const counts = summarizeRoleDraft(draft, role);
	const total = questionsForRole(role).length;
	return {
		...counts,
		total,
		percent: total === 0 ? 0 : Math.round(((total - counts.unanswered) / total) * 100)
	};
};

const validDate = (value: string) => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const isDailySopUtcTimestamp = (value: string) =>
	(() => {
		const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
		return Boolean(
			match &&
			validDate(match[1]) &&
			Number(match[2]) <= 23 &&
			Number(match[3]) <= 59 &&
			Number(match[4]) <= 59 &&
			Number.isFinite(Date.parse(value))
		);
	})();

const timestampSchema = z
	.string()
	.refine(isDailySopUtcTimestamp, 'Timestamp must be valid UTC ISO-8601');
const nonEmptyTrimmed = z.string().refine((value) => value.trim().length > 0);
const metricFieldSchema = z
	.object({
		key: nonEmptyTrimmed,
		label: nonEmptyTrimmed,
		unit: nonEmptyTrimmed,
		step: z.string().refine((value) => isPositiveDecimalString(value))
	})
	.strict();
const metricSpecSchema = z
	.object({
		fields: z.array(metricFieldSchema).min(1),
		threshold: nonEmptyTrimmed,
		parameter: z
			.object({
				key: z.enum(SOP_RATIO_KEYS),
				value: z.string().refine(isPositiveDecimalString)
			})
			.strict()
			.optional()
	})
	.strict();

const roleControlSchema = z
	.object({
		id: nonEmptyTrimmed,
		question: nonEmptyTrimmed,
		metric_spec: metricSpecSchema.nullable(),
		status: z.enum(['Pass', 'Fail', 'Pending']).nullable(),
		notes: z.string(),
		observations: z.string(),
		measured_values: z.record(z.string(), z.number().finite().min(0).nullable()),
		checked_by: nonEmptyTrimmed,
		checked_by_name: nonEmptyTrimmed.optional(),
		checked_at: timestampSchema
	})
	.strict()
	.superRefine((control, ctx) => {
		if (notesRequired(control.status) && !control.notes.trim()) {
			ctx.addIssue({
				code: 'custom',
				message: 'Pending answers require notes',
				path: ['notes']
			});
		}
	});

function issue(ctx: z.RefinementCtx, path: (string | number)[], message: string) {
	ctx.addIssue({ code: 'custom', path, message });
}

const sameMetricFields = (actual: readonly MetricField[], expected: readonly MetricField[]) =>
	actual.length === expected.length &&
	actual.every((item, i) => {
		const other = expected[i];
		return (
			item.key === other.key &&
			item.label === other.label &&
			item.unit === other.unit &&
			item.step === other.step
		);
	});

function validateControlContract(
	control: DailySopRoleControlSnapshot,
	question: DailySopRoleQuestion,
	index: number,
	ctx: z.RefinementCtx
) {
	const path: (string | number)[] = ['controls', index];
	const definition = metricDefinitions[question.id];
	if (!definition) {
		if (control.metric_spec !== null || Object.keys(control.measured_values).length > 0)
			issue(ctx, [...path, 'metric_spec'], 'Question must not have numeric metric fields');
		if (control.question !== question.text)
			issue(ctx, [...path, 'question'], 'Question text does not match the canonical snapshot');
		return;
	}
	const spec = control.metric_spec;
	if (definition.parameterKey && spec === null) {
		if (
			control.question !== questionText(question) ||
			control.status !== 'Pending' ||
			!control.notes.trim() ||
			Object.keys(control.measured_values).length > 0
		) {
			issue(
				ctx,
				[...path, 'metric_spec'],
				'An unavailable SOP parameter requires Pending and no metric values'
			);
		}
		return;
	}
	if (!spec) {
		issue(ctx, [...path, 'metric_spec'], 'Question requires its canonical metric specification');
		return;
	}
	const parameter = spec.parameter;
	if (definition.parameterKey && parameter?.key !== definition.parameterKey)
		issue(
			ctx,
			[...path, 'metric_spec', 'parameter'],
			'Question parameter does not match its canonical parameter'
		);
	if (!definition.parameterKey && parameter)
		issue(ctx, [...path, 'metric_spec', 'parameter'], 'Question does not use a parameter');
	const parameterValue =
		parameter && parameter.key === definition.parameterKey ? parameter.value : undefined;
	const expectedMetric = metricForQuestion(
		question.id,
		parameterValue && definition.parameterKey
			? { [definition.parameterKey]: parameterValue }
			: undefined
	);
	if (!expectedMetric || !sameMetricFields(spec.fields, expectedMetric.fields))
		issue(
			ctx,
			[...path, 'metric_spec', 'fields'],
			'Metric fields do not match the canonical question contract'
		);
	if (spec.threshold !== expectedMetric?.threshold)
		issue(
			ctx,
			[...path, 'metric_spec', 'threshold'],
			'Metric threshold does not match the canonical question contract'
		);
	const expectedQuestion = questionText(
		question,
		parameterValue && definition.parameterKey
			? { [definition.parameterKey]: parameterValue }
			: undefined
	);
	if (control.question !== expectedQuestion)
		issue(ctx, [...path, 'question'], 'Question text does not match the canonical snapshot');
	const expectedKeys = definition.fields.map((item) => item.key).sort();
	const measuredKeys = Object.keys(control.measured_values).sort();
	if (JSON.stringify(measuredKeys) !== JSON.stringify(expectedKeys))
		issue(ctx, [...path, 'measured_values'], 'Measured value keys must match metric fields');
	for (const item of definition.fields) {
		const amount = control.measured_values[item.key];
		if (amount !== null && amount !== undefined && !isStepAligned(amount, item.step))
			issue(ctx, [...path, 'measured_values', item.key], 'Measured value does not match its step');
	}
}

export const dailySopRoleAssessmentSchema = z
	.object({
		_id: nonEmptyTrimmed,
		_rev: nonEmptyTrimmed.optional(),
		type: z.literal(DAILY_SOP_ROLE_DOCUMENT_TYPE),
		schema_v: z.literal(DAILY_SOP_ROLE_SCHEMA_VERSION),
		shelter_code: nonEmptyTrimmed,
		assessment_date: z.string().refine(validDate, 'Assessment date must be a real YYYY-MM-DD date'),
		role_code: z.enum(
			DAILY_SOP_ROLES.map((role) => role.code) as [DailySopRoleCode, ...DailySopRoleCode[]]
		),
		role_key: z.enum(
			DAILY_SOP_ROLES.map((role) => role.key) as [DailySopRoleKey, ...DailySopRoleKey[]]
		),
		role_label: nonEmptyTrimmed,
		question_set_version: z.literal(DAILY_SOP_ROLE_QUESTION_VERSION).optional(),
		assessed_at: timestampSchema,
		assessor_name: nonEmptyTrimmed,
		status: z.enum(['InProgress', 'Completed']),
		pass_count: z.number().int().min(0),
		fail_count: z.number().int().min(0),
		pending_count: z.number().int().min(0),
		unanswered_count: z.number().int().min(0),
		controls: z.array(roleControlSchema),
		created_at: timestampSchema,
		updated_at: timestampSchema,
		created_by: nonEmptyTrimmed
	})
	.strict()
	.superRefine((assessment, ctx) => {
		const role = roleForCode(assessment.role_code);
		if (!role || assessment.role_key !== role.key || assessment.role_label !== role.label) {
			issue(ctx, ['role_code'], 'Daily SOP role identity does not match role code');
			return;
		}
		const expectedId = `${DAILY_SOP_ROLE_DOCUMENT_TYPE}:${assessment.shelter_code}:${assessment.assessment_date}:${assessment.role_code}`;
		if (assessment._id !== expectedId)
			issue(ctx, ['_id'], 'Daily SOP role assessment id is invalid');
		const expectedQuestions = questionsForRole(assessment.role_code);
		const questionIds = DAILY_SOP_ROLE_QUESTION_IDS[assessment.role_code];
		if (assessment.controls.length !== questionIds.length) {
			issue(
				ctx,
				['controls'],
				'Assessment must contain every question in its registered question set'
			);
		}
		const counts = { pass: 0, fail: 0, pending: 0, unanswered: 0 };
		assessment.controls.forEach((control, index) => {
			const question = expectedQuestions[index];
			if (!question || control.id !== question.id)
				issue(
					ctx,
					['controls', index, 'id'],
					'Question IDs and order must match the registered question set'
				);
			if (question) validateControlContract(control, question, index, ctx);
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
		)
			issue(ctx, ['pass_count'], 'Daily SOP role summary does not match its answers');
		if ((assessment.status === 'Completed') !== (counts.unanswered === 0))
			issue(ctx, ['status'], 'Daily SOP role status does not match answer completion');
	});

export const isDailySopRoleAssessment = (value: unknown): value is DailySopRoleAssessment =>
	classifyDailySopDocument(value) === 'role' &&
	dailySopRoleAssessmentSchema.safeParse(value).success;

export const registeredDailySopQuestionIds = (role: DailySopRoleCode) =>
	DAILY_SOP_ROLE_QUESTION_IDS[role];
