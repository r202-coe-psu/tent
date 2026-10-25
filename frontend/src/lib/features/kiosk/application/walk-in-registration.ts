import type { ConsentDecision } from '$lib/features/consent';
import type { SmartCardData } from '$lib/features/kiosk-devices';
import {
	KioskRequestError,
	type KioskRegistrationResult,
	registerKioskThaidWalkIn,
	registerKioskWalkIn
} from '../data/kiosk-check-in.api';
import { cancelKioskThaidSession } from '../data/kiosk-thaid.api';
import { buildKioskPhotoPayload } from './kiosk-card-photo';
import { walkInSession, type WalkInSource } from './walk-in-session.svelte';

export type WalkInCardSession = {
	citizenId: string | null;
	consentDecision: ConsentDecision | null;
	phone?: string | null;
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
	| { kind: 'error'; message: string };

function isPhoneDuplicate(cause: unknown): cause is KioskRequestError {
	return cause instanceof KioskRequestError && cause.code === 'KIOSK_PHONE_DUPLICATE';
}

function isConsentExpired(cause: unknown): cause is KioskRequestError {
	return cause instanceof KioskRequestError && cause.code === 'KIOSK_CONSENT_EXPIRED';
}

export const THAID_CONSENT_EXPIRED_MESSAGE =
	'การยินยอมและการยืนยันตัวตนด้วย ThaiD หมดเวลาแล้ว กรุณาสแกน ThaiD ใหม่อีกครั้ง';

const CARD_MISMATCH_MESSAGE = 'บัตรไม่ตรงกับบัตรที่ค้นหา กรุณาเสียบบัตรเดิมหรือติดต่อเจ้าหน้าที่';

/** The card read is not the one the walk-in started with: the message to show, else null. */
export function walkInCardMismatch(
	card: SmartCardData,
	session: Pick<WalkInCardSession, 'citizenId'>
): string | null {
	return card.citizen_id === session.citizenId ? null : CARD_MISMATCH_MESSAGE;
}

export async function registerWalkInCardRead(
	card: SmartCardData | null | undefined,
	session: WalkInCardSession,
	register: (card: SmartCardData, consent: ConsentDecision) => Promise<KioskRegistrationResult>
): Promise<WalkInCardRegistrationOutcome> {
	if (!session.consentDecision || !session.citizenId || !card) return { kind: 'ignored' };
	const mismatch = walkInCardMismatch(card, session);
	if (mismatch) return { kind: 'mismatch', message: mismatch };
	try {
		return { kind: 'registered', registration: await register(card, session.consentDecision) };
	} catch (cause) {
		if (isPhoneDuplicate(cause)) return { kind: 'phone_duplicate', message: cause.message };
		if (isConsentExpired(cause)) return { kind: 'consent_expired', message: cause.message };
		return {
			kind: 'error',
			message: cause instanceof Error ? cause.message : 'อ่านข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง'
		};
	}
}

/** Register a walk-in from the full card read: compress the chip photo, send the card without it. */
export function submitWalkInCard(
	card: SmartCardData | null | undefined,
	session: WalkInCardSession
): Promise<WalkInCardRegistrationOutcome> {
	return registerWalkInCardRead(card, session, async (fullCard, consent) => {
		const photo = await buildKioskPhotoPayload(fullCard.photo_base64).catch(() => null);
		const cardWithoutPhoto = { ...fullCard, photo_base64: undefined };
		return registerKioskWalkIn(cardWithoutPhoto, photo, consent, session.phone ?? null);
	});
}

/** Register a ThaiD walk-in: the server takes the citizen from the verified session (no photo). */
export async function submitWalkInThaid(
	session: Pick<WalkInSubmitSession, 'thaidSessionId' | 'consentDecision' | 'phone'>,
	register: typeof registerKioskThaidWalkIn = registerKioskThaidWalkIn
): Promise<WalkInCardRegistrationOutcome> {
	if (!session.consentDecision || !session.thaidSessionId) return { kind: 'ignored' };
	try {
		const registration = await register(
			session.thaidSessionId,
			session.consentDecision,
			session.phone ?? null
		);
		return { kind: 'registered', registration };
	} catch (cause) {
		if (isPhoneDuplicate(cause)) return { kind: 'phone_duplicate', message: cause.message };
		if (isConsentExpired(cause))
			return { kind: 'thaid_restart', message: THAID_CONSENT_EXPIRED_MESSAGE };
		const message = cause instanceof Error ? cause.message : 'ลงทะเบียนไม่สำเร็จ กรุณาลองอีกครั้ง';
		if (cause instanceof KioskRequestError && cause.code === 'KIOSK_THAID_SESSION_INVALID') {
			return { kind: 'expired', message };
		}
		return { kind: 'error', message };
	}
}

/** The one submit of the walk-in flow (the phone step), whichever way they proved who they are. */
export function submitWalkIn(session: WalkInSubmitSession): Promise<WalkInCardRegistrationOutcome> {
	return session.source === 'thaid'
		? submitWalkInThaid(session)
		: submitWalkInCard(session.card, session);
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
