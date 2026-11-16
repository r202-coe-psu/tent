import type { ConsentDecision } from '$lib/features/consent';
import type { SmartCardData } from '$lib/features/kiosk-devices';
import { languageStore, type LanguageCode } from '$lib/stores/language.svelte';
import {
	KioskRequestError,
	type KioskRegistrationResult,
	registerKioskThaidWalkIn,
	registerKioskWalkIn
} from '../data/kiosk-check-in.api';
import { isKioskClosedError } from '../data/kiosk-closed';
import { cancelKioskThaidSession } from '../data/kiosk-thaid.api';
import { buildKioskPhotoPayload } from './kiosk-card-photo';
import { walkInSession, type WalkInSource } from './walk-in-session.svelte';

export type WalkInCardSession = {
	citizenId: string | null;
	consentDecision: ConsentDecision | null;
	phone?: string | null;
	/** When the card was read / ThaiD verified (ISO) — sent as the Station 1 `start` time. */
	startedAt?: string | null;
};

export type WalkInSubmitSession = WalkInCardSession & {
	source: WalkInSource | null;
	thaidSessionId: string | null;
	card: SmartCardData | null;
};

export type WalkInCardRegistrationOutcome =
	| { kind: 'ignored' }
	| { kind: 'mismatch'; message: string }
	/** The new record plus the QR and label text the done page prints. */
	| { kind: 'registered'; registration: KioskRegistrationResult }
	/** ThaiD only: the verified scan expired or was used up; only a new scan can go on. */
	| { kind: 'expired'; message: string }
	/** Someone staying in the shelter already has this phone: only another phone (or none) goes on. */
	| { kind: 'phone_duplicate'; message: string }
	/** Card only: the consent decision is too old for the server, so only deciding again goes on. */
	| { kind: 'consent_expired'; message: string }
	/** ThaiD only: consent and the 180 s scan session both expired, so only a new scan goes on. */
	| { kind: 'thaid_restart'; message: string }
	/** An admin closed the kiosk: end the walk-in and show the closed page (no retry, no message). */
	| { kind: 'closed' }
	| { kind: 'error'; message: string };

function isPhoneDuplicate(cause: unknown): cause is KioskRequestError {
	return cause instanceof KioskRequestError && cause.code === 'KIOSK_PHONE_DUPLICATE';
}

function isConsentExpired(cause: unknown): cause is KioskRequestError {
	return cause instanceof KioskRequestError && cause.code === 'KIOSK_CONSENT_EXPIRED';
}

export const THAID_CONSENT_EXPIRED_MESSAGE =
	'การยินยอมและการยืนยันตัวตนด้วย ThaiD หมดเวลาแล้ว กรุณาสแกน ThaiD ใหม่อีกครั้ง';

/**
 * Messages the walk-in screens show as they are. Each takes the language as a trailing argument
 * that defaults to the kiosk's current one, so callers that already show `message` need no change.
 */
const MESSAGES: Record<
	LanguageCode,
	Record<'thaidExpired' | 'cardMismatch' | 'readFailed' | 'registerFailed', string>
> = {
	th: {
		thaidExpired: THAID_CONSENT_EXPIRED_MESSAGE,
		cardMismatch: 'บัตรไม่ตรงกับบัตรที่ค้นหา กรุณาเสียบบัตรเดิมหรือติดต่อเจ้าหน้าที่',
		readFailed: 'อ่านข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง',
		registerFailed: 'ลงทะเบียนไม่สำเร็จ กรุณาลองอีกครั้ง'
	},
	en: {
		thaidExpired: 'Consent and ThaiD verification timed out. Please scan ThaiD again',
		cardMismatch:
			'This is not the card you searched with. Please insert the original card or see staff',
		readFailed: 'Could not read the data. Please try again',
		registerFailed: 'Registration failed. Please try again'
	}
};

/**
 * English for the errors the register endpoint marks with a code. In Thai the server's own text is
 * shown, so the two cannot drift apart for the language the server writes in.
 */
const CODED_MESSAGES_EN: Record<string, string> = {
	KIOSK_PHONE_DUPLICATE:
		'This phone number is already registered. Enter another number or tap "No phone"',
	KIOSK_CONSENT_EXPIRED: 'Your consent timed out. Please give consent again',
	KIOSK_THAID_SESSION_INVALID: 'ThaiD verification expired or is not valid. Please scan again'
};

function codedMessage(cause: KioskRequestError, language: LanguageCode): string {
	return language === 'en' ? (CODED_MESSAGES_EN[cause.code ?? ''] ?? cause.message) : cause.message;
}

/** The card read is not the one the walk-in started with: the message to show, else null. */
export function walkInCardMismatch(
	card: SmartCardData,
	session: Pick<WalkInCardSession, 'citizenId'>,
	language: LanguageCode = languageStore.current
): string | null {
	return card.citizen_id === session.citizenId ? null : MESSAGES[language].cardMismatch;
}

export async function registerWalkInCardRead(
	card: SmartCardData | null | undefined,
	session: WalkInCardSession,
	register: (
		card: SmartCardData,
		consent: ConsentDecision,
		startedAt: string | null
	) => Promise<KioskRegistrationResult>,
	language: LanguageCode = languageStore.current
): Promise<WalkInCardRegistrationOutcome> {
	if (!session.consentDecision || !session.citizenId || !card) return { kind: 'ignored' };
	const mismatch = walkInCardMismatch(card, session, language);
	if (mismatch) return { kind: 'mismatch', message: mismatch };
	try {
		return {
			kind: 'registered',
			registration: await register(card, session.consentDecision, session.startedAt ?? null)
		};
	} catch (cause) {
		if (isKioskClosedError(cause)) return { kind: 'closed' };
		if (isPhoneDuplicate(cause)) {
			return { kind: 'phone_duplicate', message: codedMessage(cause, language) };
		}
		if (isConsentExpired(cause)) {
			return { kind: 'consent_expired', message: codedMessage(cause, language) };
		}
		return {
			kind: 'error',
			message: cause instanceof Error ? cause.message : MESSAGES[language].readFailed
		};
	}
}

/** Register a walk-in from the full card read: compress the chip photo, send the card without it. */
export function submitWalkInCard(
	card: SmartCardData | null | undefined,
	session: WalkInCardSession,
	language: LanguageCode = languageStore.current
): Promise<WalkInCardRegistrationOutcome> {
	return registerWalkInCardRead(
		card,
		session,
		async (fullCard, consent, startedAt) => {
			const photo = await buildKioskPhotoPayload(fullCard.photo_base64).catch(() => null);
			const cardWithoutPhoto = { ...fullCard, photo_base64: undefined };
			return registerKioskWalkIn(
				cardWithoutPhoto,
				photo,
				consent,
				session.phone ?? null,
				startedAt
			);
		},
		language
	);
}

/** Register a ThaiD walk-in: the server takes the citizen from the verified session (no photo). */
export async function submitWalkInThaid(
	session: Pick<WalkInSubmitSession, 'thaidSessionId' | 'consentDecision' | 'phone' | 'startedAt'>,
	register: typeof registerKioskThaidWalkIn = registerKioskThaidWalkIn,
	language: LanguageCode = languageStore.current
): Promise<WalkInCardRegistrationOutcome> {
	if (!session.consentDecision || !session.thaidSessionId) return { kind: 'ignored' };
	try {
		const registration = await register(
			session.thaidSessionId,
			session.consentDecision,
			session.phone ?? null,
			session.startedAt ?? null
		);
		return { kind: 'registered', registration };
	} catch (cause) {
		if (isKioskClosedError(cause)) return { kind: 'closed' };
		if (isPhoneDuplicate(cause)) {
			return { kind: 'phone_duplicate', message: codedMessage(cause, language) };
		}
		if (isConsentExpired(cause))
			return { kind: 'thaid_restart', message: MESSAGES[language].thaidExpired };
		if (cause instanceof KioskRequestError && cause.code === 'KIOSK_THAID_SESSION_INVALID') {
			return { kind: 'expired', message: codedMessage(cause, language) };
		}
		const message = cause instanceof Error ? cause.message : MESSAGES[language].registerFailed;
		return { kind: 'error', message };
	}
}

/** The one submit of the walk-in flow (the phone step), whichever way they proved who they are. */
export function submitWalkIn(
	session: WalkInSubmitSession,
	language: LanguageCode = languageStore.current
): Promise<WalkInCardRegistrationOutcome> {
	return session.source === 'thaid'
		? submitWalkInThaid(session, undefined, language)
		: submitWalkInCard(session.card, session, language);
}

/**
 * Every way out of the walk-in short of registering (cancel, back, idle): forget it, and burn a
 * ThaiD scan handed over to it so the verified identity cannot be used from this kiosk later.
 */
export function abandonWalkIn(
	session: Pick<WalkInSubmitSession, 'source' | 'thaidSessionId'> & {
		clear(): void;
	} = walkInSession,
	cancelThaid: (sessionId: string) => Promise<void> = cancelKioskThaidSession
): void {
	if (session.source === 'thaid' && session.thaidSessionId) {
		void cancelThaid(session.thaidSessionId);
	}
	session.clear();
}

/** ThaiD walk-in whose consent expired: burn the dead scan and send them to scan again, with why. */
export function restartThaidWalkIn(
	notice: string,
	session: Pick<WalkInSubmitSession, 'thaidSessionId'> & {
		restartThaid(notice: string): void;
	} = walkInSession,
	cancelThaid: (sessionId: string) => Promise<void> = cancelKioskThaidSession
): void {
	if (session.thaidSessionId) void cancelThaid(session.thaidSessionId);
	session.restartThaid(notice);
}
