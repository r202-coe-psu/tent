import { describe, expect, it } from 'vitest';
import {
	applyRejectNoteTemplate,
	combineLineRejectReasons,
	DONATION_REJECT_REASON_SELECTABLE_CODES,
	donationRejectReasonCodeSchema,
	donorRejectMessage,
	rejectDonationInputSchema,
	REJECT_NOTE_MAX,
	REJECT_NOTE_TONES,
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

describe('reject note templates (#1256)', () => {
	const PRESET_CODES = ['not_eligible', 'over_need', 'expired', 'damaged'] as const;

	it('offers three tones, formal first', () => {
		expect(REJECT_NOTE_TONES.map((t) => t.id)).toEqual(['formal', 'warm', 'concise']);
	});

	it('has a whole message in every tone for each reason that gets one', () => {
		for (const code of PRESET_CODES) {
			for (const tone of REJECT_NOTE_TONES) {
				const text = rejectNoteTemplate(code, tone.id);
				expect(text, `${code}/${tone.id}`).toBeTruthy();
				expect(text!.length, `${code}/${tone.id}`).toBeLessThanOrEqual(REJECT_NOTE_MAX);
			}
		}
	});

	it('writes each message for its own reason, not one text for all', () => {
		const over = rejectNoteTemplate('over_need', 'formal');
		const notEligible = rejectNoteTemplate('not_eligible', 'formal');
		const expired = rejectNoteTemplate('expired', 'formal');
		expect(new Set([over, notEligible, expired]).size).toBe(3);
		// Expired and damaged share the safety message.
		expect(rejectNoteTemplate('damaged', 'warm')).toBe(rejectNoteTemplate('expired', 'warm'));
	});

	it('thanks the donor in every message', () => {
		for (const code of PRESET_CODES) {
			for (const tone of REJECT_NOTE_TONES) {
				expect(rejectNoteTemplate(code, tone.id), `${code}/${tone.id}`).toContain('ขอบคุณ');
			}
		}
	});

	it('offers nothing for "other", for the legacy code, or before a reason is picked', () => {
		expect(rejectNoteTemplate('other', 'formal')).toBeNull();
		expect(rejectNoteTemplate('not_needed', 'formal')).toBeNull();
		expect(rejectNoteTemplate(undefined, 'formal')).toBeNull();
	});

	it('fills an empty note', () => {
		expect(applyRejectNoteTemplate('', 'ข้อความ')).toBe('ข้อความ');
		expect(applyRejectNoteTemplate('   ', 'ข้อความ')).toBe('ข้อความ');
	});

	it('swaps one template for another instead of stacking them', () => {
		const formal = rejectNoteTemplate('over_need', 'formal')!;
		const warm = rejectNoteTemplate('over_need', 'warm')!;
		expect(applyRejectNoteTemplate(formal, warm)).toBe(warm);
		// …even after the reason changed since the first one went in.
		const expired = rejectNoteTemplate('expired', 'concise')!;
		expect(applyRejectNoteTemplate(formal, expired)).toBe(expired);
	});

	it('appends after what staff wrote, never over it', () => {
		expect(applyRejectNoteTemplate('นมกล่องหมดอายุ 2 กล่อง', 'ข้อความ')).toBe(
			'นมกล่องหมดอายุ 2 กล่อง ข้อความ'
		);
	});

	it('leaves the note as is when the message is already in it', () => {
		expect(applyRejectNoteTemplate('ก่อนหน้า ข้อความ', 'ข้อความ')).toBe('ก่อนหน้า ข้อความ');
	});

	it('returns null when appending would pass the note limit', () => {
		expect(applyRejectNoteTemplate('ก'.repeat(REJECT_NOTE_MAX - 3), 'ข้อความ')).toBeNull();
	});
});
