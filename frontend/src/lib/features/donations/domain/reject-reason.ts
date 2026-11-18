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
 * The formal message put in the detail box the moment staff pick a reason (#1256), for them to edit.
 * The donor reads the detail on the tracking page, so none of them names a person, a phone number
 * or a shelter. Each reason says why in its own words — "we have enough" is never sent for an
 * expired item. Expired and damaged goods share one message, which carries its own thanks and,
 * unlike the other two, does not ask the donor to pass the goods on: spoiled or broken things
 * should not reach another shelter either (no separate CR — see the CR-255 decision log).
 * "other" and the legacy `not_needed` get none.
 */
const OVER_NEED =
	'ทางศูนย์ขอขอบคุณในน้ำใจของท่านเป็นอย่างยิ่ง ขณะนี้ทางศูนย์มีสิ่งของประเภทนี้เพียงพอแล้ว จึงยังไม่สามารถรับเพิ่มได้ หากท่านยังประสงค์จะช่วยเหลือ รบกวนนำไปมอบให้ศูนย์พักพิงแห่งอื่นที่ยังต้องการ จะเป็นประโยชน์ต่อผู้ที่กำลังเดือดร้อนอย่างมาก';

const NOT_ELIGIBLE =
	'ทางศูนย์ขอขอบคุณในน้ำใจของท่านเป็นอย่างยิ่ง สิ่งของนี้ไม่ตรงกับประเภทที่ทางศูนย์รับได้ รบกวนท่านนำไปมอบให้ศูนย์พักพิงแห่งอื่นที่รับสิ่งของลักษณะนี้ เพื่อให้ไปถึงมือผู้ที่ต้องการต่อไป';

const SAFETY =
	'เพื่อความปลอดภัยของผู้ใช้ ทางศูนย์ไม่สามารถรับสิ่งของที่หมดอายุหรือชำรุดได้ ขออภัยในความไม่สะดวก และขอบคุณในความตั้งใจดีของท่าน';

const REJECT_NOTE_TEMPLATES: Partial<Record<DonationRejectReasonCode, string>> = {
	over_need: OVER_NEED,
	not_eligible: NOT_ELIGIBLE,
	expired: SAFETY,
	damaged: SAFETY
};

/** The message for `code`; null when the reason has none (or none is picked). */
export function rejectNoteTemplate(code: DonationRejectReasonCode | undefined): string | null {
	return (code && REJECT_NOTE_TEMPLATES[code]) || null;
}

/** All the messages, so a note can be checked for one — staff may have written around it. */
const TEMPLATE_TEXTS: readonly string[] = [...new Set(Object.values(REJECT_NOTE_TEMPLATES))];

function findTemplateIn(note: string): string | undefined {
	return TEMPLATE_TEXTS.find((text) => note.includes(text));
}

/** True when `note` still holds one of the messages (alone, or with staff's words around it). */
export function containsRejectNoteTemplate(note: string): boolean {
	return findTemplateIn(note) !== undefined;
}

function swapIn(note: string, from: string, to: string): string {
	return note
		.replace(from, to)
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/**
 * The detail box after staff pick `code`: that reason's message goes in. An empty box takes it; a
 * message already there (alone, or among staff's words) is swapped for the new reason's, or dropped
 * when the new reason has none; staff's own words stay and the message goes after them. Only an
 * untouched message follows the reason; text staff reworded is theirs and is not this function's to
 * judge (the caller decides whether to call it). Where adding or swapping would
 * pass {@link REJECT_NOTE_MAX}, staff's text wins: the box is left as it was (or loses just the old
 * message) instead of cutting a sentence.
 */
export function noteForReason(note: string, code: DonationRejectReasonCode | undefined): string {
	const replacement = rejectNoteTemplate(code) ?? '';
	const current = note.trim();
	const existing = findTemplateIn(current);
	if (existing) {
		if (existing === replacement) return note;
		const swapped = swapIn(current, existing, replacement);
		return swapped.length > REJECT_NOTE_MAX ? swapIn(current, existing, '') : swapped;
	}
	if (replacement === '') return note;
	if (current === '') return replacement;
	const appended = `${current} ${replacement}`;
	return appended.length > REJECT_NOTE_MAX ? note : appended;
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
