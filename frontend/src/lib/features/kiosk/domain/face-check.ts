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

export const FACE_REFERENCE_STATES = ['reading', 'ready', 'unavailable'] as const;
export type FaceReferenceState = (typeof FACE_REFERENCE_STATES)[number];

const attemptSchema = z.number().int().min(0);

export const faceFrameReplySchema = z.object({
	face: z.boolean(),
	hint: z.enum(FACE_HINTS),
	ready: z.boolean(),
	/** Whether the chip photo has been read yet; older scanner clients leave it out. */
	reference: z.enum(FACE_REFERENCE_STATES).optional()
});
export type FaceFrameReply = z.infer<typeof faceFrameReplySchema>;

export const faceVerifyReplySchema = z.discriminatedUnion('result', [
	z.object({
		result: z.literal('match'),
		attempt: attemptSchema,
		/** Check-in only: the chip photo (base64 JPEG), sent once on a match so it can be kept. */
		chip_photo: z.string().min(1).optional()
	}),
	z.object({ result: z.literal('retry'), hint: z.enum(FACE_HINTS), attempt: attemptSchema }),
	z.object({ result: z.literal('not_confirmed'), reason: z.string(), attempt: attemptSchema }),
	z.object({ result: z.literal('skipped'), reason: z.string(), attempt: attemptSchema })
]);
export type FaceVerifyReply = z.infer<typeof faceVerifyReplySchema>;

export const faceStartReplySchema = z.object({
	ok: z.literal(true),
	reference: z.enum(FACE_REFERENCE_STATES),
	/** How many verdict attempts the scanner client allows; older clients leave it out. */
	max_attempts: z.number().int().min(1).optional()
});
export type FaceStartReply = z.infer<typeof faceStartReplySchema>;

// --- how a check ends ---------------------------------------------------------------------------

export type FaceCheckOutcome =
	/** `chipPhoto`: check-in only, the chip photo (base64 JPEG) the scanner client handed over. */
	| { kind: 'match'; chipPhoto?: string }
	/** The face did not match, or looked like a photo, after the allowed attempts. */
	| { kind: 'not_confirmed'; reason: string }
	/** The check could not run on this card (no chip photo, card pulled out, timed out). */
	| { kind: 'skipped'; reason: string }
	/** The person did not agree to it. */
	| { kind: 'declined' }
	/** The camera or the scanner client failed; `reason` is for the scanner client's log, not the person. */
	| { kind: 'unavailable'; reason?: FaceUnavailableReason };

export const FACE_UNAVAILABLE_REASONS = [
	'camera_denied',
	'camera_not_found',
	'camera_failed',
	'scanner_unreachable'
] as const;
export type FaceUnavailableReason = (typeof FACE_UNAVAILABLE_REASONS)[number];

function errorName(error: unknown): string {
	if (typeof error !== 'object' || error === null || !('name' in error)) return '';
	return String(error.name);
}

/**
 * Sorts a failure into something a pilot can debug from the scanner client's log. Goes by the error
 * name (not `instanceof`) so it stays pure and works for browser errors from any realm.
 */
export function classifyFaceFailure(error: unknown): FaceUnavailableReason {
	switch (errorName(error)) {
		case 'NotAllowedError':
		case 'SecurityError':
			return 'camera_denied';
		case 'NotFoundError':
		case 'OverconstrainedError':
		case 'DevicesNotFoundError':
			return 'camera_not_found';
		// The scanner client refused or did not answer: an HTTP error, a dropped fetch or a timeout.
		case 'KioskFaceError':
		case 'TypeError':
		case 'TimeoutError':
			return 'scanner_unreachable';
		default:
			return 'camera_failed';
	}
}

/** `skipped` reason when the person pressed "skip" at the camera (as opposed to the system skipping). */
export const FACE_SKIPPED_BY_PERSON = 'user_skipped';

/** `skipped` reason when staff checked the card by eye and entered the kiosk's staff PIN. */
export const FACE_BYPASSED_BY_STAFF = 'staff_bypass';

/**
 * True when the person chose to leave (declined or skipped). Only picks the wording on screen:
 * in mode `on` a choice still needs the staff PIN (see `faceOutcomeNeedsStaffPin`).
 */
export function faceOutcomeIsPersonalChoice(outcome: FaceCheckOutcome): boolean {
	return (
		outcome.kind === 'declined' ||
		(outcome.kind === 'skipped' && outcome.reason === FACE_SKIPPED_BY_PERSON)
	);
}

/** True when staff entered the PIN for this person: they already checked the card. */
export function faceOutcomeIsStaffBypass(outcome: FaceCheckOutcome): boolean {
	return outcome.kind === 'skipped' && outcome.reason === FACE_BYPASSED_BY_STAFF;
}

/**
 * Anything but a match (or a staff PIN bypass, where staff already checked) should be checked by
 * staff afterwards.
 */
export function faceOutcomeNeedsStaff(outcome: FaceCheckOutcome): boolean {
	return outcome.kind !== 'match' && !faceOutcomeIsStaffBypass(outcome);
}

/**
 * Mode `on`: only a match carries on by itself; every other ending (not confirmed, skipped,
 * camera failed, declined) waits for staff to enter the kiosk's PIN before anything is saved.
 * Shadow mode never shows the person a result, so it never asks for the PIN.
 */
export function faceOutcomeNeedsStaffPin(outcome: FaceCheckOutcome, mode: FaceCheckMode): boolean {
	return mode === 'on' && outcome.kind !== 'match';
}

/**
 * What the kiosk page does when a check ends:
 * - `hand_on`: carry on now (staff entered the PIN, or any ending outside mode `on`);
 * - `show_match`: mode `on` match - show "verified" for a moment, then carry on;
 * - `wait_for_pin`: wait for staff (an open PIN panel stays open, otherwise the result screen asks);
 * - `close_pin`: the card came out while the chip photo was needed - close an open PIN panel (that
 *   is not a staff bypass) and let the result screen ask.
 * In mode `on` only a match or a staff bypass ever carries on.
 */
export type FaceOutcomeAction = 'hand_on' | 'show_match' | 'wait_for_pin' | 'close_pin';

export function faceOutcomeAction(
	outcome: FaceCheckOutcome,
	mode: FaceCheckMode
): FaceOutcomeAction {
	if (faceOutcomeIsStaffBypass(outcome)) return 'hand_on';
	if (mode !== 'on') return 'hand_on';
	if (!faceOutcomeNeedsStaffPin(outcome, mode)) return 'show_match';
	if (outcome.kind === 'skipped' && outcome.reason === 'card_removed') return 'close_pin';
	return 'wait_for_pin';
}

/** Where the staff PIN panel was opened: at the camera, or on the result screen after the check. */
export type StaffPinOpenedFrom = 'camera' | 'result';

/**
 * Staff cancelled the PIN (cancel, Esc or 30 s idle):
 * - from the result screen: `go_home` - nothing is saved;
 * - from the camera, and the check ended meanwhile: `show_result` - the result screen asks again;
 * - from the camera, check still running: `resume` it where it was.
 */
export function staffPinCancelAction(
	from: StaffPinOpenedFrom,
	checkEnded: boolean
): 'go_home' | 'show_result' | 'resume' {
	if (from === 'result') return 'go_home';
	return checkEnded ? 'show_result' : 'resume';
}

// --- timing -------------------------------------------------------------------------------------

export const FACE_PREVIEW_INTERVAL_MS = 250;
/** A hint other than "ok" must repeat this many preview frames before the sentence on screen changes. */
export const FACE_HINT_CONFIRM_FRAMES = 2;
/** Consecutive well-framed preview frames before the burst is taken. */
export const FACE_READY_STREAK = 2;
export const FACE_BURST_FRAMES = 6;
export const FACE_BURST_INTERVAL_MS = 180;
/** Give up positioning after this long without a usable frame. */
export const FACE_POSITION_TIMEOUT_MS = 45_000;
/** How long the "try again" advice stays up before the preview resumes and replaces it. */
export const FACE_RETRY_MESSAGE_MS = 1_800;
/** Positioning that has lasted this long gets a quiet "staff will help if this does not work" line. */
export const FACE_SLOW_NOTICE_MS = 30_000;
/** Attempts shown as "2 of N" until the scanner client says otherwise. */
export const FACE_DEFAULT_MAX_ATTEMPTS = 3;
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
		? 'ใบหน้ายังไม่ตรงกับรูปในบัตร กรุณามองตรงที่กล้องแล้วลองอีกครั้ง'
		: HINT_MESSAGES[hint];
}

export type FaceOutcomeMessage = {
	/** Which icon goes with it: the face was compared, staff will check the card, or the check could not run. */
	tone: 'not_confirmed' | 'declined' | 'unchecked';
	title: string;
	detail: string;
};

/**
 * The result screen for an ending that is not a match (mode `on`). Only `not_confirmed` was really
 * compared, so only it says the face does not match; the others never use the word "ไม่ตรง".
 * Declining is the person's right, so its wording is plain service, not a failure.
 */
export function faceOutcomeMessage(
	outcome: Exclude<FaceCheckOutcome, { kind: 'match' }>
): FaceOutcomeMessage {
	switch (outcome.kind) {
		case 'not_confirmed':
			return {
				tone: 'not_confirmed',
				title: 'ใบหน้าไม่ตรงกับรูปในบัตรประชาชน',
				detail: 'กรุณาติดต่อเจ้าหน้าที่เพื่อตรวจสอบตัวตน'
			};
		case 'declined':
			return {
				tone: 'declined',
				title: 'เจ้าหน้าที่จะตรวจบัตรให้ท่าน',
				detail: 'กรุณาติดต่อเจ้าหน้าที่ ท่านยังรับบริการได้ตามปกติ'
			};
		default:
			return {
				tone: 'unchecked',
				title: 'ระบบตรวจใบหน้าไม่ได้',
				detail: 'กรุณาติดต่อเจ้าหน้าที่'
			};
	}
}
