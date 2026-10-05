import { z } from 'zod';

/** Which kiosk flows run the face check. */
export const FACE_CHECK_FLOWS = ['check_in', 'walk_in'] as const;
export type FaceCheckFlow = (typeof FACE_CHECK_FLOWS)[number];

/** off: nothing changes · shadow: runs but never affects the person · on: tells the person. */
export const FACE_CHECK_MODES = ['off', 'shadow', 'on'] as const;
export type FaceCheckMode = (typeof FACE_CHECK_MODES)[number];

export type FaceCheckConfig = { mode: FaceCheckMode; flows: readonly FaceCheckFlow[] };

/** Machines without a scanner client (or any error) never run the check. */
export const FACE_CHECK_OFF: FaceCheckConfig = { mode: 'off', flows: [] };

/** What the scanner client reports under `face_check`; anything unexpected means off. */
export function parseFaceCheckConfig(value: unknown): FaceCheckConfig {
	const parsed = z
		.object({
			mode: z.enum(FACE_CHECK_MODES),
			flows: z.array(z.enum(FACE_CHECK_FLOWS))
		})
		.safeParse(value);
	if (!parsed.success || parsed.data.mode === 'off') return FACE_CHECK_OFF;
	return parsed.data;
}

export function isFaceCheckEnabled(config: FaceCheckConfig, flow: FaceCheckFlow): boolean {
	return config.mode !== 'off' && config.flows.includes(flow);
}

// --- what one camera frame / one attempt can say ------------------------------------------------

export const FACE_HINTS = [
	'ok',
	'no_face',
	'multiple_faces',
	'too_far',
	'too_close',
	'turn_straight',
	'too_dark',
	'too_bright',
	'blurry',
	'reference_pending'
] as const;
export type FaceHint = (typeof FACE_HINTS)[number];

const attemptSchema = z.number().int().min(0);

export const faceFrameReplySchema = z.object({
	face: z.boolean(),
	hint: z.enum(FACE_HINTS),
	ready: z.boolean()
});
export type FaceFrameReply = z.infer<typeof faceFrameReplySchema>;

export const faceVerifyReplySchema = z.discriminatedUnion('result', [
	z.object({ result: z.literal('match'), attempt: attemptSchema }),
	z.object({ result: z.literal('retry'), hint: z.enum(FACE_HINTS), attempt: attemptSchema }),
	z.object({ result: z.literal('not_confirmed'), reason: z.string(), attempt: attemptSchema }),
	z.object({ result: z.literal('skipped'), reason: z.string(), attempt: attemptSchema })
]);
export type FaceVerifyReply = z.infer<typeof faceVerifyReplySchema>;

export const faceStartReplySchema = z.object({
	ok: z.literal(true),
	reference: z.enum(['reading', 'ready', 'unavailable'])
});
export type FaceStartReply = z.infer<typeof faceStartReplySchema>;

// --- how a check ends ---------------------------------------------------------------------------

export type FaceCheckOutcome =
	| { kind: 'match' }
	/** The face did not match, or looked like a photo, after the allowed attempts. */
	| { kind: 'not_confirmed'; reason: string }
	/** The check could not run on this card (no chip photo, card pulled out, timed out). */
	| { kind: 'skipped'; reason: string }
	/** The person did not agree to it. */
	| { kind: 'declined' }
	/** The camera or the scanner client failed. */
	| { kind: 'unavailable' };

/** Anything but a match goes to staff; the check never refuses anyone service. */
export function faceOutcomeNeedsStaff(outcome: FaceCheckOutcome): boolean {
	return outcome.kind !== 'match';
}

// --- timing -------------------------------------------------------------------------------------

export const FACE_PREVIEW_INTERVAL_MS = 250;
/** Consecutive well-framed preview frames before the burst is taken. */
export const FACE_READY_STREAK = 2;
export const FACE_BURST_FRAMES = 6;
export const FACE_BURST_INTERVAL_MS = 180;
/** Give up positioning after this long without a usable frame. */
export const FACE_POSITION_TIMEOUT_MS = 45_000;
/** How long the "try again" advice stays up before the preview resumes and replaces it. */
export const FACE_RETRY_MESSAGE_MS = 1_800;
/** How long a match is shown before the flow continues by itself. */
export const FACE_MATCH_SHOWN_MS = 1_400;

// --- wording ------------------------------------------------------------------------------------

const HINT_MESSAGES: Record<FaceHint, string> = {
	ok: 'กรุณามองตรงที่กล้อง และอยู่นิ่งสักครู่',
	no_face: 'ยังไม่พบใบหน้า กรุณามองตรงที่กล้อง',
	multiple_faces: 'กรุณาให้มีเพียงท่านเดียวในภาพ',
	too_far: 'กรุณาขยับเข้าใกล้กล้องอีกนิด',
	too_close: 'กรุณาถอยออกจากกล้องเล็กน้อย',
	turn_straight: 'กรุณามองตรงที่กล้อง ไม่ก้มหรือเอียงหน้า',
	too_dark: 'แสงน้อยเกินไป กรุณาหันหน้าเข้าหาแสง',
	too_bright: 'แสงจ้าเกินไป กรุณาหลีกเลี่ยงแสงจ้า',
	blurry: 'ภาพไม่ชัด กรุณาอยู่นิ่งๆ สักครู่',
	reference_pending: 'กำลังอ่านรูปจากบัตร กรุณาอย่าดึงบัตรออก'
};

/** One short instruction for the person at the camera. */
export function faceHintMessage(hint: FaceHint): string {
	return HINT_MESSAGES[hint];
}

/** After an attempt that did not match: say what to fix, or just ask for another try. */
export function faceRetryMessage(hint: FaceHint): string {
	return hint === 'ok'
		? 'ระบบยังยืนยันไม่ได้ กรุณามองตรงที่กล้องแล้วลองอีกครั้ง'
		: HINT_MESSAGES[hint];
}
