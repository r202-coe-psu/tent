import { describe, expect, it } from 'vitest';
import {
	applyRejectNotePreset,
	combineLineRejectReasons,
	DONATION_REJECT_REASON_SELECTABLE_CODES,
	donationRejectReasonCodeSchema,
	donorRejectMessage,
	rejectDonationInputSchema,
	REJECT_NOTE_MAX,
	REJECT_NOTE_PRESETS,
	REJECT_NOTE_TONES,
	DEFAULT_REJECT_NOTE_TONE,
	parseRejectNoteTone,
	REJECT_REASON_MAX,
	rejectNotePresetsFor
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

describe('reject note presets (#1256)', () => {
	const ids = (code: Parameters<typeof rejectNotePresetsFor>[0]) =>
		rejectNotePresetsFor(code).map((p) => p.id);

	it('offers the thanks note and the forward note for over_need', () => {
		expect(ids('over_need')).toEqual(['thanks', 'forward']);
	});

	it('offers the not-eligible forward note for not_eligible', () => {
		expect(ids('not_eligible')).toEqual(['thanks', 'not_eligible_forward']);
	});

	it('offers the safety note for expired and damaged', () => {
		expect(ids('expired')).toEqual(['thanks', 'safety']);
		expect(ids('damaged')).toEqual(['thanks', 'safety']);
	});

	it('offers nothing for "other", nor before a reason is picked, nor for legacy not_needed', () => {
		expect(ids('other')).toEqual([]);
		expect(rejectNotePresetsFor(undefined)).toEqual([]);
		expect(ids('not_needed')).toEqual([]);
	});

	it('offers three tones, formal first and by default (#1256)', () => {
		expect(REJECT_NOTE_TONES.map((t) => t.id)).toEqual(['formal', 'warm', 'concise']);
		expect(DEFAULT_REJECT_NOTE_TONE).toBe('formal');
	});

	it('reads a stored tone back, falling back to the default for anything else', () => {
		expect(parseRejectNoteTone('warm')).toBe('warm');
		expect(parseRejectNoteTone('concise')).toBe('concise');
		expect(parseRejectNoteTone('shouting')).toBe('formal');
		expect(parseRejectNoteTone(null)).toBe('formal');
	});

	it('has a text in every tone for every preset, inside the note limit', () => {
		for (const preset of Object.values(REJECT_NOTE_PRESETS)) {
			for (const tone of REJECT_NOTE_TONES) {
				const text = preset.texts[tone.id];
				expect(text.length, `${preset.id}/${tone.id}`).toBeGreaterThan(0);
				expect(text.length, `${preset.id}/${tone.id}`).toBeLessThan(REJECT_NOTE_MAX);
			}
		}
	});

	it('lets staff chain the thanks note with any other preset, in any tone', () => {
		const { thanks, ...rest } = REJECT_NOTE_PRESETS;
		for (const tone of REJECT_NOTE_TONES) {
			for (const preset of Object.values(rest)) {
				const chained = applyRejectNotePreset(thanks.texts[tone.id], preset.texts[tone.id]);
				expect(chained, `${preset.id}/${tone.id}`).not.toBeNull();
				expect(chained!.length).toBeLessThanOrEqual(REJECT_NOTE_MAX);
			}
		}
	});

	it('fills an empty note with the preset text', () => {
		expect(applyRejectNotePreset('', 'ขอบคุณ')).toBe('ขอบคุณ');
		expect(applyRejectNotePreset('   ', 'ขอบคุณ')).toBe('ขอบคุณ');
	});

	it('appends after what staff already wrote, never overwriting it', () => {
		expect(applyRejectNotePreset('นมกล่องหมดอายุ 2 กล่อง', 'ขอบคุณ')).toBe(
			'นมกล่องหมดอายุ 2 กล่อง ขอบคุณ'
		);
	});

	it('leaves the note as is when the preset is already in it', () => {
		expect(applyRejectNotePreset('ขอบคุณ', 'ขอบคุณ')).toBe('ขอบคุณ');
	});

	it('returns null when the result would pass the note limit', () => {
		expect(applyRejectNotePreset('ก'.repeat(REJECT_NOTE_MAX - 3), 'ขอบคุณ')).toBeNull();
	});
});
