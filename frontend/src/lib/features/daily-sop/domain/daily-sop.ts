import { z } from 'zod';

export const DAILY_SOP_SCHEMA_VERSION = 1 as const;
export const DAILY_SOP_DOCUMENT_TYPE = 'daily_sop_assessment' as const;
export const DAILY_SOP_QUESTION_SET_VERSION = 'daily-sop-v1' as const;

export const SOP_UI_STATUSES = ['Pass', 'Fail', 'Pending'] as const;
export type SopUiStatus = (typeof SOP_UI_STATUSES)[number];
export const SOP_STORED_STATUSES = ['Yes', 'No', 'Pending'] as const;
/** Canonical persisted status contract used by the document schema. */
export type SopStatus = (typeof SOP_STORED_STATUSES)[number];
export type SopStoredStatus = SopStatus;
export const DAILY_SOP_ASSESSMENT_STATUSES = ['InProgress', 'Completed'] as const;
export type DailySopAssessmentStatus = (typeof DAILY_SOP_ASSESSMENT_STATUSES)[number];
export const LIFELINE_STATUSES = ['Operational', 'Interrupted', 'Critical'] as const;
export type LifelineStatus = (typeof LIFELINE_STATUSES)[number];
export const LIFELINE_KEYS = ['electricity', 'water', 'gas', 'telecom'] as const;
export type LifelineId = (typeof LIFELINE_KEYS)[number];

export const DAILY_SOP_SECTIONS = [
	{ id: 'registration', label: '1. ระบบลงทะเบียนผู้ประสบภัย', shortLabel: 'ลงทะเบียน' },
	{ id: 'vulnerable', label: '2. การดูแลกลุ่มเปราะบาง', shortLabel: 'กลุ่มเปราะบาง' },
	{ id: 'volunteer', label: '3. การบริหารจัดการอาสาสมัคร', shortLabel: 'อาสาสมัคร' },
	{ id: 'utilities', label: '4. ระบบสาธารณูปโภคและอาหาร', shortLabel: 'สาธารณูปโภค' },
	{ id: 'communications', label: '5. ระบบสื่อสารและแจ้งเตือน', shortLabel: 'การสื่อสาร' },
	{ id: 'database', label: '6. การเชื่อมต่อกับ One Data Platform', shortLabel: 'ฐานข้อมูล' }
] as const;

export type DailySopSectionId = (typeof DAILY_SOP_SECTIONS)[number]['id'];
export type AssessmentSectionId = DailySopSectionId | 'lifelines';

export interface DailySopQuestion {
	id: string;
	sectionId: DailySopSectionId;
	prompt: string;
}

export interface DailySopSection {
	id: DailySopSectionId;
	label: string;
	shortLabel: string;
	items: readonly DailySopQuestion[];
}

export interface DailySopDraft {
	controls: Record<string, SopUiStatus>;
	answeredControls: Record<string, boolean>;
	controlAudit: Record<string, DailySopControlAudit | null>;
	lifelines: Record<LifelineId, LifelineStatus | null>;
}

export interface DailySopControlAudit {
	checkedBy: string;
	checkedAt: string;
}

export interface DailySopControlSnapshot {
	id: string;
	section_id: DailySopSectionId;
	question: string;
	status: SopStoredStatus;
	/** Distinguishes an explicit Pending choice from an unanswered control. */
	answered: boolean;
	checked_by: string;
	checked_at: string;
}

export interface DailySopAssessment {
	_id: string;
	_rev?: string;
	type: typeof DAILY_SOP_DOCUMENT_TYPE;
	schema_v: typeof DAILY_SOP_SCHEMA_VERSION;
	shelter_code: string;
	assessment_date: string;
	assessed_at: string;
	assessor_name: string;
	status: DailySopAssessmentStatus;
	progress_percent: number;
	pass_percent: number;
	risk_label: string;
	controls: DailySopControlSnapshot[];
	lifelines: Record<LifelineId, LifelineStatus | null>;
	created_at: string;
	updated_at: string;
	created_by: string;
}

export const DAILY_SOP_QUESTIONS: readonly DailySopQuestion[] = [
	{
		id: 'sop-reg-1',
		sectionId: 'registration',
		prompt: 'จุดคัดกรองอาการเจ็บป่วยเบื้องต้นมีความพร้อมในการให้บริการ 100% หรือไม่?'
	},
	{
		id: 'sop-reg-2',
		sectionId: 'registration',
		prompt:
			'จัดโต๊ะลงทะเบียนช่องทางปกติและช่องทางพิเศษ (Fast Track) สำหรับกลุ่มเปราะบาง พร้อมให้บริการอย่างรวดเร็วและมีล่ามแปลภาษาหรือไม่?'
	},
	{
		id: 'sop-reg-3',
		sectionId: 'registration',
		prompt:
			'บันทึกข้อมูลประวัติการแพ้ยา การรับฝากทรัพย์สิน ยานพาหนะ และสัตว์เลี้ยงเข้าสู่ระบบอย่างครบถ้วนหรือไม่?'
	},
	{
		id: 'sop-vul-1',
		sectionId: 'vulnerable',
		prompt:
			'คัดแยกและจัดผังพื้นที่ (Zone Management) ให้กลุ่มเปราะบางอย่างปลอดภัยและเหมาะสม (โซนผู้สูงอายุ, โซนครอบครัว, โซนแยกชาย/หญิง หรือโซนสัตว์เลี้ยง) หรือไม่?'
	},
	{
		id: 'sop-vul-2',
		sectionId: 'vulnerable',
		prompt:
			'ระบบป้ายกำกับ (Tag) สถานะผู้ป่วยได้รับการอัปเดต เพื่อให้ทีมแพทย์และสาธารณสุขสามารถเข้าถึงและประเมินอาการได้ทันทีหรือไม่?'
	},
	{
		id: 'sop-vol-1',
		sectionId: 'volunteer',
		prompt: 'จำนวนอาสาสมัครที่มารายงานตัวเพียงพอต่อความต้องการในวันนี้หรือไม่?'
	},
	{
		id: 'sop-vol-2',
		sectionId: 'volunteer',
		prompt: 'กระจายงานให้ตรงกับทักษะที่ศูนย์ต้องการในวันนั้น (Skill Matching) สำเร็จแล้วหรือไม่?'
	},
	{
		id: 'sop-vol-3',
		sectionId: 'volunteer',
		prompt: 'มอบหมายงานผ่าน "บัตรงาน (Role Card)" ซึ่งระบุข้อปฏิบัติชัดเจนแก่อาสาสมัครทุกคนหรือไม่?'
	},
	{
		id: 'sop-vol-4',
		sectionId: 'volunteer',
		prompt: 'การจัดการสวัสดิการของอาสาสมัคร (เช่น ความเพียงพอของอาหาร เสื้อผ้า) เรียบร้อยหรือไม่?'
	},
	{
		id: 'sop-ut-1',
		sectionId: 'utilities',
		prompt:
			'พื้นที่พักพิง (Space): ตรวจสอบความแออัดของศูนย์ โดยต้องรักษาระยะพื้นที่อยู่อาศัยขั้นต่ำที่ 3.5 ตารางเมตรต่อคน หรือไม่?'
	},
	{
		id: 'sop-ut-2',
		sectionId: 'utilities',
		prompt:
			'ระบบน้ำและสุขอนามัย (WASH): ตรวจสอบปริมาณน้ำดื่มและน้ำใช้ ว่ามีเพียงพอขั้นต่ำ 15 ลิตรต่อคนต่อวัน หรือไม่?'
	},
	{
		id: 'sop-ut-3',
		sectionId: 'utilities',
		prompt:
			'ระบบน้ำและสุขอนามัย (WASH): มีห้องน้ำที่สะอาดใช้งานได้ในอัตราส่วนขั้นต่ำ 1 ห้องต่อ 20 คน หรือไม่?'
	},
	{
		id: 'sop-ut-4',
		sectionId: 'utilities',
		prompt:
			'การจัดการอาหาร (Food Management): ความพร้อมของครัวกลาง วัตถุดิบ และอาหารปรุงสำเร็จ มีเพียงพอต่อความต้องการพลังงานขั้นต่ำ 2,100 กิโลแคลอรีต่อคนต่อวัน หรือไม่?'
	},
	{
		id: 'sop-ut-5',
		sectionId: 'utilities',
		prompt:
			'การจัดการอาหาร (Food Management): ตรวจสอบนมสำหรับเด็กทารกหรืออาหารสำหรับผู้ป่วยว่ามีการจัดเตรียมเรียบร้อยแล้วหรือไม่?'
	},
	{
		id: 'sop-ut-6',
		sectionId: 'utilities',
		prompt:
			'สถานะสาธารณูปโภค (Lifeline Status): ข้อมูลไฟฟ้า น้ำประปา แก๊ส หรือเครือข่ายโทรศัพท์ ได้รับการประเมินและรายงานเพื่อพร้อมร้องขอส่วนกลางแล้วหรือไม่?'
	},
	{
		id: 'sop-com-1',
		sectionId: 'communications',
		prompt:
			'ความพร้อมของการประสานงานและการสื่อสารทั้งภายในและภายนอกศูนย์พักพิงดำเนินการได้ตามปกติหรือไม่?'
	},
	{
		id: 'sop-com-2',
		sectionId: 'communications',
		prompt:
			'ทดสอบความพร้อมของ "ระบบสื่อสารสำรอง" (เช่น วิทยุชุมชนระบบ VHF หรืออุปกรณ์แอนะล็อก) เรียบร้อยแล้วหรือไม่?'
	},
	{
		id: 'sop-db-1',
		sectionId: 'database',
		prompt:
			'ระบบสแกนเข้า-ออก (Check-in/Check-out) ประมวลผลจำนวนคนในศูนย์ได้ตรงกับความเป็นจริงหรือไม่?'
	},
	{
		id: 'sop-db-2',
		sectionId: 'database',
		prompt:
			'แพลตฟอร์มสามารถซิงค์ข้อมูล (Sync) ส่งต่อไปยังส่วนกลาง (One Data Platform) ได้อย่างสมบูรณ์เพื่อแสดงผลบน Dashboard EOC หรือไม่?'
	}
] as const;

export const DAILY_SOP_LIFELINES = [
	{ id: 'electricity', label: 'ไฟฟ้า' },
	{ id: 'water', label: 'น้ำประปา' },
	{ id: 'gas', label: 'แก๊สหุงต้ม' },
	{ id: 'telecom', label: 'โทรคมนาคม' }
] as const;

export const DAILY_SOP_SECTIONS_WITH_ITEMS: readonly DailySopSection[] = DAILY_SOP_SECTIONS.map(
	(section) => ({
		...section,
		items: DAILY_SOP_QUESTIONS.filter((item) => item.sectionId === section.id)
	})
);
export const SOP_SECTION_COUNTS = [3, 2, 4, 6, 2, 2] as const;
export const TOTAL_SOP_ITEMS = DAILY_SOP_QUESTIONS.length;
export const sopStoredStatusSchema = z.enum(SOP_STORED_STATUSES);
export const lifelineStatusSchema = z.enum(LIFELINE_STATUSES);

const dailySopControlSnapshotSchema = z.object({
	id: z.string().min(1),
	section_id: z.enum(
		DAILY_SOP_SECTIONS.map((section) => section.id) as [DailySopSectionId, ...DailySopSectionId[]]
	),
	question: z.string().min(1),
	status: sopStoredStatusSchema,
	answered: z.boolean(),
	checked_by: z.string().min(1),
	checked_at: z.string().min(1)
});

const dailySopAssessmentShape = z
	.object({
		_id: z.string().min(1),
		type: z.literal(DAILY_SOP_DOCUMENT_TYPE),
		schema_v: z.literal(DAILY_SOP_SCHEMA_VERSION),
		shelter_code: z.string().min(1),
		assessment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		assessed_at: z.string().min(1),
		assessor_name: z.string().min(1),
		status: z.enum(DAILY_SOP_ASSESSMENT_STATUSES),
		progress_percent: z.number().int().min(0).max(100),
		pass_percent: z.number().int().min(0).max(100),
		risk_label: z.string().min(1),
		controls: z.array(dailySopControlSnapshotSchema).length(TOTAL_SOP_ITEMS),
		lifelines: z.object({
			electricity: lifelineStatusSchema.nullable(),
			water: lifelineStatusSchema.nullable(),
			gas: lifelineStatusSchema.nullable(),
			telecom: lifelineStatusSchema.nullable()
		}),
		created_at: z.string().min(1),
		updated_at: z.string().min(1),
		created_by: z.string().min(1)
	})
	.passthrough();

export const dailySopAssessmentSchema = dailySopAssessmentShape;

export const isDailySopAssessment = (value: unknown): value is DailySopAssessment => {
	return dailySopAssessmentSchema.safeParse(value).success;
};

const UI_TO_STORED: Record<SopUiStatus, SopStoredStatus> = {
	Pass: 'Yes',
	Fail: 'No',
	Pending: 'Pending'
};
const STORED_TO_UI: Record<SopStoredStatus, SopUiStatus> = {
	Yes: 'Pass',
	No: 'Fail',
	Pending: 'Pending'
};
export const toStoredStatus = (status: SopUiStatus): SopStoredStatus => UI_TO_STORED[status];
export const toUiStatus = (status: SopStoredStatus): SopUiStatus => STORED_TO_UI[status];

export const draftFromAssessment = (assessment: DailySopAssessment): DailySopDraft => ({
	controls: Object.fromEntries(
		assessment.controls.map((control) => [control.id, toUiStatus(control.status)])
	) as Record<string, SopUiStatus>,
	answeredControls: Object.fromEntries(
		assessment.controls.map((control) => [control.id, control.answered])
	) as Record<string, boolean>,
	controlAudit: Object.fromEntries(
		assessment.controls.map((control) => [
			control.id,
			{ checkedBy: control.checked_by, checkedAt: control.checked_at }
		])
	) as Record<string, DailySopControlAudit | null>,
	lifelines: { ...assessment.lifelines }
});

export const createEmptyDraft = (): DailySopDraft => ({
	controls: Object.fromEntries(
		DAILY_SOP_QUESTIONS.map((question) => [question.id, 'Pending'])
	) as Record<string, SopUiStatus>,
	answeredControls: Object.fromEntries(
		DAILY_SOP_QUESTIONS.map((question) => [question.id, false])
	) as Record<string, boolean>,
	controlAudit: Object.fromEntries(
		DAILY_SOP_QUESTIONS.map((question) => [question.id, null])
	) as Record<string, DailySopControlAudit | null>,
	lifelines: { electricity: null, water: null, gas: null, telecom: null }
});

export const answerControl = (
	draft: DailySopDraft,
	id: string,
	status: SopUiStatus,
	checkedBy: string,
	checkedAt: string
): DailySopDraft => ({
	...draft,
	controls: { ...draft.controls, [id]: status },
	answeredControls: { ...draft.answeredControls, [id]: true },
	controlAudit: { ...draft.controlAudit, [id]: { checkedBy, checkedAt } }
});

/**
 * A completed assessment requires an explicit answer for every control and
 * lifeline. Failures are valid assessment results and are persisted so they
 * can be reviewed and edited from History; the initial Pending value remains
 * the only unanswered control state.
 */
export const canComplete = (draft: DailySopDraft): boolean =>
	DAILY_SOP_QUESTIONS.every((question) => isControlAnswered(draft, question.id)) &&
	LIFELINE_KEYS.every((key) => draft.lifelines[key] !== null);

export const assessmentStatusFor = (draft: DailySopDraft): DailySopAssessmentStatus =>
	canComplete(draft) ? 'Completed' : 'InProgress';

const isControlAnswered = (draft: DailySopDraft, id: string): boolean =>
	draft.answeredControls[id] === true || draft.controls[id] !== 'Pending';

export const sectionProgress = (draft: DailySopDraft, sectionId: DailySopSectionId) => {
	const items = DAILY_SOP_QUESTIONS.filter((item) => item.sectionId === sectionId);
	return {
		done: items.filter((item) => isControlAnswered(draft, item.id)).length,
		total: items.length
	};
};

export const lifelineProgress = (draft: DailySopDraft) => ({
	done: LIFELINE_KEYS.filter((key) => draft.lifelines[key] !== null).length,
	total: LIFELINE_KEYS.length
});

export const summarizeDraft = (draft: DailySopDraft) => {
	const answered = DAILY_SOP_QUESTIONS.filter((question) =>
		isControlAnswered(draft, question.id)
	).length;
	const passed = DAILY_SOP_QUESTIONS.filter(
		(question) => draft.controls[question.id] === 'Pass'
	).length;
	const reported = lifelineProgress(draft).done;
	const hasRisk =
		DAILY_SOP_QUESTIONS.some((question) => draft.controls[question.id] === 'Fail') ||
		DAILY_SOP_QUESTIONS.some((question) => draft.controls[question.id] === 'Pending') ||
		LIFELINE_KEYS.some(
			(key) => draft.lifelines[key] !== null && draft.lifelines[key] !== 'Operational'
		) ||
		answered < TOTAL_SOP_ITEMS ||
		reported < LIFELINE_KEYS.length;
	return {
		progressPercent: Math.round(
			((answered + reported) / (TOTAL_SOP_ITEMS + LIFELINE_KEYS.length)) * 100
		),
		passPercent: answered === 0 ? 0 : Math.round((passed / answered) * 100),
		riskLabel: hasRisk ? 'พบความเสี่ยง' : 'ไม่พบความเสี่ยง'
	};
};
