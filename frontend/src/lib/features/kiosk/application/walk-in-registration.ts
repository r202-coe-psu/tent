import type { SmartCardData } from '$lib/features/scanners';
import {
	KioskRequestError,
	registerKioskThaidWalkIn,
	registerKioskWalkIn
} from '../data/kiosk-check-in.api';
import { cancelKioskThaidSession } from '../data/kiosk-thaid.api';
import { buildKioskPhotoPayload } from './kiosk-card-photo';
import { walkInSession, type WalkInSource } from './walk-in-session.svelte';

export type WalkInCardSession = {
	citizenId: string | null;
	consented: boolean;
	consentedAt: string | null;
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
	| { kind: 'registered' }
	/** ThaiD only: the verified scan expired or was used up; only a new scan can go on. */
	| { kind: 'expired'; message: string }
	| { kind: 'error'; message: string };

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
	register: (card: SmartCardData, consentedAt: string) => Promise<unknown>
): Promise<WalkInCardRegistrationOutcome> {
	if (!session.consented || !session.citizenId || !card) return { kind: 'ignored' };
	const mismatch = walkInCardMismatch(card, session);
	if (mismatch) return { kind: 'mismatch', message: mismatch };
	if (!session.consentedAt) {
		return { kind: 'error', message: 'ไม่พบเวลาการยินยอม กรุณาเริ่มใหม่' };
	}
	try {
		await register(card, session.consentedAt);
		return { kind: 'registered' };
	} catch (cause) {
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
	return registerWalkInCardRead(card, session, async (fullCard, consentedAt) => {
		const photo = await buildKioskPhotoPayload(fullCard.photo_base64).catch(() => null);
		const cardWithoutPhoto = { ...fullCard, photo_base64: undefined };
		return registerKioskWalkIn(cardWithoutPhoto, photo, consentedAt, session.phone ?? null);
	});
}

/** Register a ThaiD walk-in: the server takes the citizen from the verified session (no photo). */
export async function submitWalkInThaid(
	session: Pick<WalkInSubmitSession, 'thaidSessionId' | 'consented' | 'consentedAt' | 'phone'>,
	register: typeof registerKioskThaidWalkIn = registerKioskThaidWalkIn
): Promise<WalkInCardRegistrationOutcome> {
	if (!session.consented || !session.thaidSessionId) return { kind: 'ignored' };
	if (!session.consentedAt) {
		return { kind: 'error', message: 'ไม่พบเวลาการยินยอม กรุณาเริ่มใหม่' };
	}
	try {
		await register(session.thaidSessionId, session.consentedAt, session.phone ?? null);
		return { kind: 'registered' };
	} catch (cause) {
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
