import type { SmartCardData } from '$lib/features/scanners';

export type WalkInCardSession = {
	citizenId: string | null;
	consented: boolean;
	consentedAt: string | null;
};

export type WalkInCardRegistrationOutcome =
	| { kind: 'ignored' }
	| { kind: 'mismatch'; message: string }
	| { kind: 'registered' }
	| { kind: 'error'; message: string };

export async function registerWalkInCardRead(
	card: SmartCardData | null | undefined,
	session: WalkInCardSession,
	register: (card: SmartCardData, consentedAt: string) => Promise<unknown>
): Promise<WalkInCardRegistrationOutcome> {
	if (!session.consented || !session.citizenId || !card) return { kind: 'ignored' };
	if (card.citizen_id !== session.citizenId) {
		return {
			kind: 'mismatch',
			message: 'บัตรไม่ตรงกับบัตรที่ค้นหา กรุณาเสียบบัตรเดิมหรือติดต่อเจ้าหน้าที่'
		};
	}
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
