import { describe, expect, it } from 'vitest';
import {
	containsRejectNoteTemplate,
	noteForReason,
	combineLineRejectReasons,
	DONATION_REJECT_REASON_SELECTABLE_CODES,
	donationRejectReasonCodeSchema,
	donorRejectMessage,
	rejectDonationInputSchema,
	REJECT_NOTE_MAX,
	rejectNoteTemplate,
	REJECT_REASON_MAX
} from './reject-reason';

describe('donorRejectMessage (CR-172)', () => {
	it('reads the preset alone when staff add nothing', () => {
		expect(donorRejectMessage('expired')).toBe('หมดอายุ');
	});

	it('puts the detail after the preset', () => {
		expect(donorRejectMessage('damaged', ' กล่องเปียก ')).toBe('ชำรุดเสียหาย — กล่องเปียก');
	});

	it('uses only the detail for "other" — the label says nothing to the donor', () => {
		expect(donorRejectMessage('other', 'ศูนย์ปิดรับชั่วคราว')).toBe('ศูนย์ปิดรับชั่วคราว');
	});

	it('reads the split codes (#1166)', () => {
		expect(donorRejectMessage('not_eligible')).toBe('ไม่ตรงเกณฑ์การรับ');
		expect(donorRejectMessage('over_need', 'ของซ้ำ')).toBe('เกินความต้องการ — ของซ้ำ');
	});

	it('still reads the legacy not_needed code on old documents (#1166)', () => {
		expect(donorRejectMessage('not_needed')).toBe('ไม่ตรงเกณฑ์การรับ / เกินความต้องการ');
	});

	it('offers only the new codes for selection (#1166)', () => {
		expect(DONATION_REJECT_REASON_SELECTABLE_CODES).not.toContain('not_needed');
		expect(DONATION_REJECT_REASON_SELECTABLE_CODES).toContain('not_eligible');
		expect(DONATION_REJECT_REASON_SELECTABLE_CODES).toContain('over_need');
	});

	it('never exceeds the field limit', () => {
		expect(donorRejectMessage('other', 'ก'.repeat(900)).length).toBe(REJECT_REASON_MAX);
	});
});

describe('rejectDonationInputSchema (FR-6, AC-4)', () => {
	it('accepts a preset with or without a detail', () => {
		expect(rejectDonationInputSchema.safeParse({ reason_code: 'not_eligible' }).success).toBe(true);
		expect(rejectDonationInputSchema.safeParse({ reason_code: 'over_need' }).success).toBe(true);
		expect(
			rejectDonationInputSchema.safeParse({ reason_code: 'expired', note: 'ล็อตเก่า' }).success
		).toBe(true);
	});

	it('refuses the legacy not_needed on input but still reads it (#1166)', () => {
		expect(rejectDonationInputSchema.safeParse({ reason_code: 'not_needed' }).success).toBe(false);
		expect(donationRejectReasonCodeSchema.safeParse('not_needed').success).toBe(true);
	});

	it('refuses "other" without a detail, and an unknown code', () => {
		expect(rejectDonationInputSchema.safeParse({ reason_code: 'other' }).success).toBe(false);
		expect(rejectDonationInputSchema.safeParse({ reason_code: 'other', note: '  ' }).success).toBe(
			false
		);
		expect(rejectDonationInputSchema.safeParse({ reason_code: 'nope' }).success).toBe(false);
	});
});

describe('combineLineRejectReasons (FR-12)', () => {
	it('falls back to other for the two split codes, and for legacy + new (#1166)', () => {
		expect(
			combineLineRejectReasons([
				{ reject_reason: 'ไม่ตรงเกณฑ์การรับ', reject_reason_code: 'not_eligible' },
				{ reject_reason: 'เกินความต้องการ', reject_reason_code: 'over_need' }
			])
		).toEqual({ reject_reason: 'ไม่ตรงเกณฑ์การรับ; เกินความต้องการ', reject_reason_code: 'other' });
		expect(
			combineLineRejectReasons([
				{ reject_reason: 'x', reject_reason_code: 'not_needed' },
				{ reject_reason: 'y', reject_reason_code: 'over_need' }
			]).reject_reason_code
		).toBe('other');
		expect(
			combineLineRejectReasons([
				{ reject_reason: 'เกินความต้องการ', reject_reason_code: 'over_need' },
				{ reject_reason: 'เกินความต้องการ', reject_reason_code: 'over_need' }
			])
		).toEqual({ reject_reason: 'เกินความต้องการ', reject_reason_code: 'over_need' });
	});

	it('keeps the shared code when every line agrees, and says each reason once', () => {
		expect(
			combineLineRejectReasons([
				{ reject_reason: 'หมดอายุ', reject_reason_code: 'expired' },
				{ reject_reason: 'หมดอายุ', reject_reason_code: 'expired' }
			])
		).toEqual({ reject_reason: 'หมดอายุ', reject_reason_code: 'expired' });
	});

	it('falls back to "other" when the lines were turned away for different reasons', () => {
		expect(
			combineLineRejectReasons([
				{ reject_reason: 'หมดอายุ', reject_reason_code: 'expired' },
				{ reject_reason: 'ชำรุดเสียหาย', reject_reason_code: 'damaged' }
			])
		).toEqual({ reject_reason: 'หมดอายุ; ชำรุดเสียหาย', reject_reason_code: 'other' });
	});

	it('leaves out a line that has no words of its own (code other, no detail)', () => {
		expect(
			combineLineRejectReasons([
				{ reject_reason: 'หมดอายุ', reject_reason_code: 'expired' },
				{ reject_reason: '', reject_reason_code: 'other' }
			])
		).toEqual({ reject_reason: 'หมดอายุ', reject_reason_code: 'other' });
		expect(combineLineRejectReasons([{ reject_reason: '', reject_reason_code: 'other' }])).toEqual({
			reject_reason: '',
			reject_reason_code: 'other'
		});
	});
});

describe('reject note template (#1256)', () => {
	const PRESET_CODES = ['not_eligible', 'over_need', 'expired', 'damaged'] as const;
	const t = (code: Parameters<typeof rejectNoteTemplate>[0]) => rejectNoteTemplate(code)!;

	it('has one formal message for each reason that gets one, inside the note limit', () => {
		for (const code of PRESET_CODES) {
			expect(t(code), code).toBeTruthy();
			expect(t(code).length, code).toBeLessThanOrEqual(REJECT_NOTE_MAX);
		}
	});

	it('writes each message for its own reason, expired and damaged sharing one', () => {
		expect(new Set([t('over_need'), t('not_eligible'), t('expired')]).size).toBe(3);
		expect(t('damaged')).toBe(t('expired'));
	});

	it('thanks the donor in every message', () => {
		for (const code of PRESET_CODES) expect(t(code), code).toContain('ขอบคุณ');
	});

	it('offers nothing for "other", for the legacy code, or before a reason is picked', () => {
		expect(rejectNoteTemplate('other')).toBeNull();
		expect(rejectNoteTemplate('not_needed')).toBeNull();
		expect(rejectNoteTemplate(undefined)).toBeNull();
	});

	it('recognises a template anywhere in a note, and nothing else', () => {
		expect(containsRejectNoteTemplate(t('over_need'))).toBe(true);
		expect(containsRejectNoteTemplate(`นมหมดอายุ ${t('expired')} ติดต่อหน้างาน`)).toBe(true);
		expect(containsRejectNoteTemplate('นมหมดอายุ 2 กล่อง')).toBe(false);
		expect(containsRejectNoteTemplate('')).toBe(false);
	});
});

// The message goes in as soon as a reason is picked, and a message written for one reason must
// never reach the donor under another (#1256 review round 3, B1).
describe('noteForReason (#1256)', () => {
	const t = (code: Parameters<typeof rejectNoteTemplate>[0]) => rejectNoteTemplate(code)!;

	it('fills an empty note with the reason’s message', () => {
		expect(noteForReason('', 'over_need')).toBe(t('over_need'));
		expect(noteForReason('   ', 'expired')).toBe(t('expired'));
	});

	it('swaps the message when the reason changes', () => {
		expect(noteForReason(t('over_need'), 'expired')).toBe(t('expired'));
		expect(noteForReason(t('not_eligible'), 'over_need')).toBe(t('over_need'));
	});

	it('keeps what staff wrote around the message, whichever side', () => {
		expect(noteForReason(`นมหมดอายุ ${t('over_need')}`, 'damaged')).toBe(
			`นมหมดอายุ ${t('damaged')}`
		);
		expect(noteForReason(`${t('over_need')} ติดต่อหน้างาน`, 'damaged')).toBe(
			`${t('damaged')} ติดต่อหน้างาน`
		);
	});

	it('puts the message after staff’s own words when none is in the note yet', () => {
		expect(noteForReason('นมหมดอายุ 2 กล่อง', 'expired')).toBe(`นมหมดอายุ 2 กล่อง ${t('expired')}`);
	});

	it('drops the message, keeping staff text, when the new reason has none', () => {
		expect(noteForReason(t('over_need'), 'other')).toBe('');
		expect(noteForReason(`นมหมดอายุ ${t('over_need')}`, 'other')).toBe('นมหมดอายุ');
		expect(noteForReason('นมหมดอายุ 2 กล่อง', 'other')).toBe('นมหมดอายุ 2 กล่อง');
		expect(noteForReason(t('over_need'), undefined)).toBe('');
	});

	it('leaves the note alone when the message already fits the reason', () => {
		expect(noteForReason(t('expired'), 'damaged')).toBe(t('expired'));
	});

	it('leaves staff text alone rather than pass the limit when adding the message', () => {
		const filler = 'ก'.repeat(REJECT_NOTE_MAX - 10);
		expect(noteForReason(filler, 'over_need')).toBe(filler);
	});

	it('drops the old message rather than pass the limit when the new one is longer', () => {
		const over = t('over_need');
		const filler = 'ก'.repeat(REJECT_NOTE_MAX - over.length - 1);
		const result = noteForReason(`${filler} ${over}`, 'not_eligible');
		expect(result.length).toBeLessThanOrEqual(REJECT_NOTE_MAX);
	});
});
