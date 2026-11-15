import { z } from 'zod';

/**
 * Why staff turned a donation — or one line of it — away (CR-172).
 *
 * There is ONE reason field and the donor reads it on the tracking page (owner,
 * 2026-10-17): no separate internal note. Staff pick a preset and may add a detail;
 * the server composes the text the donor sees from both, so the preview in the
 * dialog and the stored `reject_reason` can never disagree.
 */
export const DONATION_REJECT_REASON_CODES = [
	'not_eligible',
	'over_need',
	'expired',
	'damaged',
	'other',
	'not_needed'
] as const;
/** Every code a stored document may carry (including legacy `not_needed`). */
export const donationRejectReasonCodeSchema = z.enum(DONATION_REJECT_REASON_CODES);
export type DonationRejectReasonCode = z.infer<typeof donationRejectReasonCodeSchema>;

/**
 * Codes new forms and inputs offer/accept. `not_needed` is legacy read-only: it stays valid on
 * old documents (and its label stays) but was split into `not_eligible` / `over_need` (#1166).
 */
export const DONATION_REJECT_REASON_SELECTABLE_CODES = [
	'not_eligible',
	'over_need',
	'expired',
	'damaged',
	'other'
] as const;
export const selectableRejectReasonCodeSchema = z.enum(DONATION_REJECT_REASON_SELECTABLE_CODES);
export type SelectableDonationRejectReasonCode = z.infer<typeof selectableRejectReasonCodeSchema>;

export const DONATION_REJECT_REASON_LABELS: Record<DonationRejectReasonCode, string> = {
	not_eligible: 'ไม่ตรงเกณฑ์การรับ',
	over_need: 'เกินความต้องการ',
	not_needed: 'ไม่ตรงเกณฑ์การรับ / เกินความต้องการ',
	expired: 'หมดอายุ',
	damaged: 'ชำรุดเสียหาย',
	other: 'อื่นๆ'
};

/** `reject_reason` on the doc (FR-1, FR-3). */
export const REJECT_REASON_MAX = 500;
/** Leaves room for the preset label in front of the detail. */
export const REJECT_NOTE_MAX = 400;

const noteSchema = z
	.string()
	.trim()
	.max(REJECT_NOTE_MAX, `รายละเอียดยาวได้ไม่เกิน ${REJECT_NOTE_MAX} ตัวอักษร`);

/** FR-6 / AC-4 — `other` says nothing on its own, so it needs the detail. */
export function requireNoteForOther(
	value: { reason_code?: DonationRejectReasonCode; note?: string },
	ctx: z.RefinementCtx,
	path: (string | number)[] = ['note']
) {
	if (value.reason_code === 'other' && !value.note?.trim()) {
		ctx.addIssue({ code: 'custom', path, message: 'เลือก "อื่นๆ" ต้องระบุรายละเอียด' });
	}
}

/** Body of `POST /api/back-office/donations/[query]/reject`. */
export const rejectDonationInputSchema = z
	.object({ reason_code: selectableRejectReasonCodeSchema, note: noteSchema.optional() })
	.superRefine((value, ctx) => requireNoteForOther(value, ctx));
export type RejectDonationInput = z.infer<typeof rejectDonationInputSchema>;

export const rejectNoteSchema = noteSchema;

/**
 * Whole messages staff can drop into the detail box with one tap (#1256), then edit. The donor
 * reads the detail on the tracking page, so none of them names a person, a phone number or a
 * shelter. Each reason that gets one reads in three tones — formal (automated replies, SMS),
 * warm (chat with one donor), concise (notices, short texts) — and says why in its own words, so
 * "we have enough" is never sent for an expired item. "other" and the legacy `not_needed` get none.
 */
export const REJECT_NOTE_TONES = [
	{ id: 'formal', label: 'ทางการ' },
	{ id: 'warm', label: 'อบอุ่น' },
	{ id: 'concise', label: 'กระชับ' }
] as const;
export type RejectNoteTone = (typeof REJECT_NOTE_TONES)[number]['id'];

type ToneTexts = Record<RejectNoteTone, string>;

const OVER_NEED: ToneTexts = {
	formal:
		'ทางศูนย์ขอขอบคุณในน้ำใจของท่านเป็นอย่างยิ่ง ขณะนี้ทางศูนย์มีสิ่งของประเภทนี้เพียงพอแล้ว จึงยังไม่สามารถรับเพิ่มได้ หากท่านยังประสงค์จะช่วยเหลือ รบกวนนำไปมอบให้ศูนย์พักพิงแห่งอื่นที่ยังต้องการ จะเป็นประโยชน์ต่อผู้ที่กำลังเดือดร้อนอย่างมาก',
	warm: 'ขอบคุณมากที่นึกถึงพวกเราและตั้งใจมาช่วย ตอนนี้ของประเภทนี้ที่ศูนย์เรามีพอแล้ว เลยยังรับเพิ่มไม่ได้ ถ้ายังอยากช่วย ลองนำไปให้ศูนย์อื่นที่ยังขาดอยู่นะ ของจะได้ไปถึงคนที่รออยู่ได้เร็วขึ้น',
	concise:
		'ขอบคุณที่ตั้งใจช่วยเหลือ ตอนนี้ศูนย์มีของประเภทนี้พอแล้ว รบกวนส่งต่อให้ศูนย์อื่นที่ยังต้องการ'
};

const NOT_ELIGIBLE: ToneTexts = {
	formal:
		'ทางศูนย์ขอขอบคุณในน้ำใจของท่านเป็นอย่างยิ่ง สิ่งของนี้ไม่ตรงกับประเภทที่ทางศูนย์รับได้ รบกวนท่านนำไปมอบให้ศูนย์พักพิงแห่งอื่นที่รับสิ่งของลักษณะนี้ เพื่อให้ไปถึงมือผู้ที่ต้องการต่อไป',
	warm: 'ขอบคุณมากที่นึกถึงพวกเราและตั้งใจมาช่วย ของชิ้นนี้ไม่ตรงกับที่ศูนย์เรารับได้ในตอนนี้ ขอโทษที่รับไว้ไม่ได้นะ ลองนำไปให้ศูนย์อื่นที่รับของแบบนี้ดู ของที่ตั้งใจให้จะได้ไปถึงคนที่ต้องการจริง ๆ',
	concise:
		'ขอบคุณที่ตั้งใจช่วยเหลือ ของนี้ไม่ตรงกับที่ศูนย์รับได้ รบกวนส่งต่อให้ศูนย์อื่นที่รับของลักษณะนี้'
};

/** Expired and damaged goods share one message; it carries its own thanks. */
const SAFETY: ToneTexts = {
	formal:
		'เพื่อความปลอดภัยของผู้ใช้ ทางศูนย์ไม่สามารถรับสิ่งของที่หมดอายุหรือชำรุดได้ ขออภัยในความไม่สะดวก และขอบคุณในความตั้งใจดีของท่าน',
	warm: 'ศูนย์รับของที่หมดอายุหรือชำรุดไม่ได้ เพราะอาจเป็นอันตรายกับคนที่นำไปใช้ ขอโทษด้วยนะ แต่ขอบคุณจริง ๆ ที่ตั้งใจช่วย',
	concise:
		'เพื่อความปลอดภัย ศูนย์รับของที่หมดอายุหรือชำรุดไม่ได้ ขออภัยด้วย ขอบคุณที่ตั้งใจช่วยเหลือ'
};

const REJECT_NOTE_TEMPLATES: Partial<Record<DonationRejectReasonCode, ToneTexts>> = {
	over_need: OVER_NEED,
	not_eligible: NOT_ELIGIBLE,
	expired: SAFETY,
	damaged: SAFETY
};

/** The whole message for `code` in `tone`; null when the reason has none (or none is picked). */
export function rejectNoteTemplate(
	code: DonationRejectReasonCode | undefined,
	tone: RejectNoteTone
): string | null {
	return (code && REJECT_NOTE_TEMPLATES[code]?.[tone]) || null;
}

const ALL_TEMPLATE_TEXTS: ReadonlySet<string> = new Set(
	Object.values(REJECT_NOTE_TEMPLATES).flatMap((texts) => Object.values(texts!))
);

/**
 * Put `text` in the detail box. A box that is empty, or still holds only a template, takes the new
 * one in its place (so changing tone or reason swaps rather than stacks); anything staff wrote
 * stays and the template goes after it. Null when appending would pass {@link REJECT_NOTE_MAX},
 * so the caller can leave the box alone instead of cutting a sentence.
 */
export function applyRejectNoteTemplate(note: string, text: string): string | null {
	const current = note.trim();
	if (current === '' || ALL_TEMPLATE_TEXTS.has(current)) return text;
	if (current.includes(text)) return current;
	const next = `${current} ${text}`;
	return next.length > REJECT_NOTE_MAX ? null : next;
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The sentence the donor reads: the preset, then the detail if staff wrote one. */
export function donorRejectMessage(code: DonationRejectReasonCode, note?: string | null): string {
	const detail = note?.trim() ?? '';
	if (code === 'other') return truncate(detail, REJECT_REASON_MAX);
	const label = DONATION_REJECT_REASON_LABELS[code];
	return truncate(detail ? `${label} — ${detail}` : label, REJECT_REASON_MAX);
}

/**
 * FR-12 — every line turned away at the counter rejects the whole booking. Its reason
 * is the lines' reasons joined (each once, a line with no words of its own — code `other`
 * and no detail — adds nothing), and its code is theirs when they agree.
 */
export function combineLineRejectReasons(
	lines: readonly { reject_reason: string; reject_reason_code: DonationRejectReasonCode }[]
): { reject_reason: string; reject_reason_code: DonationRejectReasonCode } {
	const reasons = [...new Set(lines.map((line) => line.reject_reason))].filter(
		(reason) => reason !== ''
	);
	const codes = new Set(lines.map((line) => line.reject_reason_code));
	return {
		reject_reason: truncate(reasons.join('; '), REJECT_REASON_MAX),
		reject_reason_code: codes.size === 1 ? [...codes][0] : 'other'
	};
}
