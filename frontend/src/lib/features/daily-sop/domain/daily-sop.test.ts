import { describe, expect, it } from 'vitest';
import {
	DAILY_SOP_LIFELINES,
	DAILY_SOP_QUESTIONS,
	DAILY_SOP_SECTIONS_WITH_ITEMS,
	LIFELINE_KEYS,
	SOP_SECTION_COUNTS,
	answerControl,
	canComplete,
	createEmptyDraft,
	dailySopAssessmentSchema,
	lifelineProgress,
	sectionProgress,
	summarizeDraft,
	toStoredStatus,
	toUiStatus
} from './daily-sop';

const PROTOTYPE_QUESTIONS = [
	'จุดคัดกรองอาการเจ็บป่วยเบื้องต้นมีความพร้อมในการให้บริการ 100% หรือไม่?',
	'จัดโต๊ะลงทะเบียนช่องทางปกติและช่องทางพิเศษ (Fast Track) สำหรับกลุ่มเปราะบาง พร้อมให้บริการอย่างรวดเร็วและมีล่ามแปลภาษาหรือไม่?',
	'บันทึกข้อมูลประวัติการแพ้ยา การรับฝากทรัพย์สิน ยานพาหนะ และสัตว์เลี้ยงเข้าสู่ระบบอย่างครบถ้วนหรือไม่?',
	'คัดแยกและจัดผังพื้นที่ (Zone Management) ให้กลุ่มเปราะบางอย่างปลอดภัยและเหมาะสม (โซนผู้สูงอายุ, โซนครอบครัว, โซนแยกชาย/หญิง หรือโซนสัตว์เลี้ยง) หรือไม่?',
	'ระบบป้ายกำกับ (Tag) สถานะผู้ป่วยได้รับการอัปเดต เพื่อให้ทีมแพทย์และสาธารณสุขสามารถเข้าถึงและประเมินอาการได้ทันทีหรือไม่?',
	'จำนวนอาสาสมัครที่มารายงานตัวเพียงพอต่อความต้องการในวันนี้หรือไม่?',
	'กระจายงานให้ตรงกับทักษะที่ศูนย์ต้องการในวันนั้น (Skill Matching) สำเร็จแล้วหรือไม่?',
	'มอบหมายงานผ่าน "บัตรงาน (Role Card)" ซึ่งระบุข้อปฏิบัติชัดเจนแก่อาสาสมัครทุกคนหรือไม่?',
	'การจัดการสวัสดิการของอาสาสมัคร (เช่น ความเพียงพอของอาหาร เสื้อผ้า) เรียบร้อยหรือไม่?',
	'พื้นที่พักพิง (Space): ตรวจสอบความแออัดของศูนย์ โดยต้องรักษาระยะพื้นที่อยู่อาศัยขั้นต่ำที่ 3.5 ตารางเมตรต่อคน หรือไม่?',
	'ระบบน้ำและสุขอนามัย (WASH): ตรวจสอบปริมาณน้ำดื่มและน้ำใช้ ว่ามีเพียงพอขั้นต่ำ 15 ลิตรต่อคนต่อวัน หรือไม่?',
	'ระบบน้ำและสุขอนามัย (WASH): มีห้องน้ำที่สะอาดใช้งานได้ในอัตราส่วนขั้นต่ำ 1 ห้องต่อ 20 คน หรือไม่?',
	'การจัดการอาหาร (Food Management): ความพร้อมของครัวกลาง วัตถุดิบ และอาหารปรุงสำเร็จ มีเพียงพอต่อความต้องการพลังงานขั้นต่ำ 2,100 กิโลแคลอรีต่อคนต่อวัน หรือไม่?',
	'การจัดการอาหาร (Food Management): ตรวจสอบนมสำหรับเด็กทารกหรืออาหารสำหรับผู้ป่วยว่ามีการจัดเตรียมเรียบร้อยแล้วหรือไม่?',
	'สถานะสาธารณูปโภค (Lifeline Status): ข้อมูลไฟฟ้า น้ำประปา แก๊ส หรือเครือข่ายโทรศัพท์ ได้รับการประเมินและรายงานเพื่อพร้อมร้องขอส่วนกลางแล้วหรือไม่?',
	'ความพร้อมของการประสานงานและการสื่อสารทั้งภายในและภายนอกศูนย์พักพิงดำเนินการได้ตามปกติหรือไม่?',
	'ทดสอบความพร้อมของ "ระบบสื่อสารสำรอง" (เช่น วิทยุชุมชนระบบ VHF หรืออุปกรณ์แอนะล็อก) เรียบร้อยแล้วหรือไม่?',
	'ระบบสแกนเข้า-ออก (Check-in/Check-out) ประมวลผลจำนวนคนในศูนย์ได้ตรงกับความเป็นจริงหรือไม่?',
	'แพลตฟอร์มสามารถซิงค์ข้อมูล (Sync) ส่งต่อไปยังส่วนกลาง (One Data Platform) ได้อย่างสมบูรณ์เพื่อแสดงผลบน Dashboard EOC หรือไม่?'
] as const;

describe('Daily SOP definition', () => {
	it('contains the prototype 6 sections and 19 questions', () => {
		expect(DAILY_SOP_SECTIONS_WITH_ITEMS).toHaveLength(6);
		expect(DAILY_SOP_QUESTIONS).toHaveLength(19);
		expect(DAILY_SOP_SECTIONS_WITH_ITEMS.map((section) => section.items.length)).toEqual([
			...SOP_SECTION_COUNTS
		]);
		expect(DAILY_SOP_LIFELINES).toHaveLength(4);
	});

	it('keeps stable IDs and the exact prototype anchors', () => {
		expect(new Set(DAILY_SOP_QUESTIONS.map((question) => question.id)).size).toBe(19);
		expect(DAILY_SOP_QUESTIONS.map((question) => question.prompt)).toEqual(PROTOTYPE_QUESTIONS);
		expect(DAILY_SOP_QUESTIONS[0].prompt).toBe(
			'จุดคัดกรองอาการเจ็บป่วยเบื้องต้นมีความพร้อมในการให้บริการ 100% หรือไม่?'
		);
		expect(DAILY_SOP_QUESTIONS[9].prompt).toContain('3.5 ตารางเมตรต่อคน');
		expect(DAILY_SOP_QUESTIONS[10].prompt).toContain('15 ลิตรต่อคนต่อวัน');
		expect(DAILY_SOP_QUESTIONS[11].prompt).toContain('1 ห้องต่อ 20 คน');
		expect(DAILY_SOP_QUESTIONS[12].prompt).toContain('2,100 กิโลแคลอรีต่อคนต่อวัน');
	});
});

describe('Daily SOP status and gating', () => {
	it('requires per-control evaluation metadata in snapshots', () => {
		const incompleteSnapshot = {
			_id: 'daily_sop_assessment:SH001:2026-06-11',
			type: 'daily_sop_assessment',
			schema_v: 1,
			shelter_code: 'SH001',
			assessment_date: '2026-06-11',
			assessed_at: '2026-06-11T08:00:00.000Z',
			assessor_name: 'staff01',
			status: 'Completed',
			progress_percent: 100,
			pass_percent: 100,
			risk_label: 'ไม่พบความเสี่ยง',
			controls: DAILY_SOP_QUESTIONS.map((question) => ({
				id: question.id,
				section_id: question.sectionId,
				question: question.prompt,
				status: 'Yes',
				answered: true
			})),
			lifelines: {
				electricity: 'Operational',
				water: 'Operational',
				gas: 'Operational',
				telecom: 'Operational'
			},
			created_at: '2026-06-11T08:00:00.000Z',
			updated_at: '2026-06-11T08:00:00.000Z',
			created_by: 'staff01'
		};
		expect(() => dailySopAssessmentSchema.parse(incompleteSnapshot)).toThrow();
	});

	it('maps UI statuses to storage and back', () => {
		expect(toStoredStatus('Pass')).toBe('Yes');
		expect(toStoredStatus('Fail')).toBe('No');
		expect(toStoredStatus('Pending')).toBe('Pending');
		expect(toUiStatus('Yes')).toBe('Pass');
		expect(toUiStatus('No')).toBe('Fail');
		expect(toUiStatus('Pending')).toBe('Pending');
	});

	it('starts with every control pending and every lifeline unreported', () => {
		const draft = createEmptyDraft();
		expect(Object.values(draft.controls)).toHaveLength(19);
		expect(Object.values(draft.controls).every((status) => status === 'Pending')).toBe(true);
		expect(Object.values(draft.lifelines).every((status) => status === null)).toBe(true);
		expect(canComplete(draft)).toBe(false);
	});

	it('records evaluator metadata only for the answer that changed', () => {
		const draft = createEmptyDraft();
		const answered = answerControl(
			draft,
			'sop-reg-1',
			'Pass',
			'staff01',
			'2026-08-31T12:11:00.000Z'
		);
		expect(answered.controlAudit['sop-reg-1']).toEqual({
			checkedBy: 'staff01',
			checkedAt: '2026-08-31T12:11:00.000Z'
		});
		expect(answered.controlAudit['sop-reg-2']).toBeNull();
		expect(draft.controlAudit['sop-reg-1']).toBeNull();
	});

	it('allows a completed snapshot when every item has an explicit status', () => {
		const draft = createEmptyDraft();
		DAILY_SOP_QUESTIONS.forEach((question) => (draft.controls[question.id] = 'Pass'));
		LIFELINE_KEYS.forEach((key) => (draft.lifelines[key] = 'Operational'));
		expect(canComplete(draft)).toBe(true);
		draft.controls['sop-reg-1'] = 'Fail';
		expect(canComplete(draft)).toBe(true);
		draft.controls['sop-reg-1'] = 'Pass';
		draft.lifelines.gas = 'Interrupted';
		expect(canComplete(draft)).toBe(true);
		draft.controls['sop-reg-1'] = 'Pending';
		draft.answeredControls['sop-reg-1'] = true;
		expect(canComplete(draft)).toBe(true);
		draft.answeredControls['sop-reg-1'] = false;
		expect(canComplete(draft)).toBe(false);
		draft.controls['sop-reg-1'] = 'Pass';
		draft.lifelines.gas = null;
		expect(canComplete(draft)).toBe(false);
	});

	it('counts selected answers on menu cards, not only passing answers', () => {
		const draft = createEmptyDraft();
		draft.controls['sop-reg-1'] = 'Fail';
		draft.lifelines.water = 'Critical';
		expect(sectionProgress(draft, 'registration')).toEqual({ done: 1, total: 3 });
		expect(lifelineProgress(draft)).toEqual({ done: 1, total: 4 });
	});

	it('calculates the design summary without adding statuses', () => {
		const draft = createEmptyDraft();
		DAILY_SOP_QUESTIONS.slice(0, 17).forEach((question) => (draft.controls[question.id] = 'Pass'));
		const summary = summarizeDraft(draft);
		expect(summary.progressPercent).toBe(74);
		expect(summary.passPercent).toBe(100);
		expect(summary.riskLabel).toBe('พบความเสี่ยง');
	});

	it('marks completed assessments with Fail or an interrupted lifeline as at risk', () => {
		const draft = createEmptyDraft();
		DAILY_SOP_QUESTIONS.forEach((question) => (draft.controls[question.id] = 'Pass'));
		LIFELINE_KEYS.forEach((key) => (draft.lifelines[key] = 'Operational'));
		expect(summarizeDraft(draft).riskLabel).toBe('ไม่พบความเสี่ยง');

		draft.controls['sop-reg-1'] = 'Fail';
		expect(summarizeDraft(draft).riskLabel).toBe('พบความเสี่ยง');

		draft.controls['sop-reg-1'] = 'Pass';
		draft.lifelines.electricity = 'Critical';
		expect(summarizeDraft(draft).riskLabel).toBe('พบความเสี่ยง');
	});
});
