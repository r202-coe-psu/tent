import {
	checkPersonQr,
	extractScanPersonQr,
	staffPersonQrRejectionMessage,
	type Evacuee,
	type EvacueeQrPrintsReader
} from '$lib/features/people';
import {
	isStaffCardScanCode,
	parseStaffCardPayload,
	type ResolvedCardRecipient
} from '$lib/features/users';
import { parseVolunteerScanCode, type Volunteer } from '$lib/features/volunteers';
import type { FrontlineRecipientSelection } from './frontline-handover';
import { parsePoolScanCode } from './bulk-return-pool-qr';

const STAFF_CARD_FALLBACK_MESSAGE = 'ตรวจสอบบัตรเจ้าหน้าที่ไม่สำเร็จ กรุณาลองสแกนใหม่';
const STAFF_CARD_MALFORMED_MESSAGE = 'QR บัตรเจ้าหน้าที่ไม่ถูกต้อง';
const POOL_QR_IN_RECIPIENT_SCAN_MESSAGE = 'นี่คือ QR ของกองรับคืน กรุณาสแกน QR ผู้คืน';

/**
 * Recipient-picker scan routing (#650): one scanner takes both evacuee cards and volunteer
 * passes. Pure over injected lookups so the routing is testable without a component.
 */
export type ScannedRecipient =
	| { kind: 'evacuee'; evacuee: Evacuee; qrOverride?: QrOverrideDates }
	| { kind: 'volunteer'; volunteer: Volunteer }
	| { kind: 'staff_card'; selection: FrontlineRecipientSelection }
	/**
	 * `expiredQr` is set only for an expired Person QR (CR-233 A1 FR-EQR-44): the caller may offer
	 * "accept the risk" and scan again with `acceptExpiredQr`. Invalid QRs never carry it.
	 */
	| { kind: 'error'; message: string; expiredQr?: true };

/** Dates of the accepted expired QR plus when it was accepted (CR-233 A1 FR-EQR-48; no PII). */
export interface QrOverrideDates {
	issued_at: string | null;
	current_printed_at: string;
	overridden_at: string;
}

export interface RecipientScanDeps {
	lookupEvacuee: (code: string) => Promise<Evacuee | null>;
	lookupVolunteer: (code: string) => Promise<Volunteer | null>;
	/**
	 * Reads `evacuee_qr:{ULID}` prints (missing doc = []) for the Person QR scan rule (CR-233).
	 * Rejections (offline, auth) propagate to the caller's existing error handling, never "valid".
	 */
	listQrPrints: EvacueeQrPrintsReader;
	resolveStaffCard?: (payload: string) => Promise<ResolvedCardRecipient>;
}

export function volunteerDisplayName(volunteer: Volunteer): string {
	const name = `${volunteer.first_name} ${volunteer.last_name}`.trim();
	return volunteer.nickname ? `${name} (${volunteer.nickname})` : name;
}

export function toVolunteerSelection(volunteer: Volunteer): FrontlineRecipientSelection {
	return {
		recipientType: 'volunteer',
		recipientId: volunteer._id,
		label: volunteerDisplayName(volunteer),
		phone: volunteer.phone,
		volunteerCode: volunteer.volunteer_code
	};
}

/**
 * A volunteer credential goes to the volunteer lookup only — never the evacuee search, which
 * would fuzzy-match a pass URL. `inactive` is the volunteer soft-delete (schema.md §2.8
 * soft-delete policy), so a deactivated profile cannot receive.
 */
export async function resolveScannedRecipient(
	code: string,
	options: { allowVolunteer: boolean; allowStaff?: boolean; acceptExpiredQr?: boolean },
	deps: RecipientScanDeps
): Promise<ScannedRecipient> {
	if (parsePoolScanCode(code)) {
		return { kind: 'error', message: POOL_QR_IN_RECIPIENT_SCAN_MESSAGE };
	}
	if (isStaffCardScanCode(code)) {
		if (!options.allowStaff) {
			return {
				kind: 'error',
				message: 'QR เจ้าหน้าที่ใช้กับรายการนี้ไม่ได้ กรุณาสแกนบัตรผู้ประสบภัย'
			};
		}
		if (!parseStaffCardPayload(code)) {
			return { kind: 'error', message: STAFF_CARD_MALFORMED_MESSAGE };
		}
		if (!deps.resolveStaffCard) return { kind: 'error', message: STAFF_CARD_FALLBACK_MESSAGE };
		let card: ResolvedCardRecipient;
		try {
			card = await deps.resolveStaffCard(code);
		} catch (err) {
			return {
				kind: 'error',
				message: err instanceof Error && err.message ? err.message : STAFF_CARD_FALLBACK_MESSAGE
			};
		}
		const selection: FrontlineRecipientSelection =
			card.kind === 'staff'
				? {
						recipientType: 'staff',
						recipientId: card.recipient_id,
						label: card.display_name,
						roleLabel: card.role_label,
						position: card.position
					}
				: { recipientType: 'volunteer', recipientId: card.recipient_id, label: card.display_name };
		return { kind: 'staff_card', selection };
	}
	if (parseVolunteerScanCode(code)) {
		if (!options.allowVolunteer) {
			return { kind: 'error', message: 'QR จิตอาสาใช้กับรายการนี้ไม่ได้ กรุณาสแกนบัตรผู้ประสบภัย' };
		}
		const volunteer = await deps.lookupVolunteer(code);
		if (!volunteer) {
			return {
				kind: 'error',
				message: `ไม่พบจิตอาสาจากรหัส "${code}" ลองสแกนใหม่หรือค้นหาด้วยชื่อ`
			};
		}
		if (volunteer.status !== 'active') {
			return {
				kind: 'error',
				message: `โปรไฟล์จิตอาสา ${volunteerDisplayName(volunteer)} ถูกปิดใช้งานแล้ว`
			};
		}
		return { kind: 'volunteer', volunteer };
	}

	// Person QR `evacuee:{ULID}[@hash6]` (CR-233 FR-EQR-27/34): expired / invalid never resolves a
	// recipient. A handover-slip path (`/onsite/medical-screening/evacuee:…`) is a hash-less Person QR. Bare ULIDs are registration tickets and skip the rule (FR-EQR-31). The id passed
	// onward has no `@` (FR-EQR-6).
	const personQr = extractScanPersonQr(code);
	let qrOverride: QrOverrideDates | undefined;
	if (personQr) {
		const verdict = await checkPersonQr(personQr, deps.listQrPrints);
		if (verdict.status === 'expired' && options.acceptExpiredQr) {
			// CR-233 A1: staff accepted the risk; keep the dates for the audit on the distribution log.
			qrOverride = {
				issued_at: verdict.issued_at,
				current_printed_at: verdict.current_printed_at,
				overridden_at: new Date().toISOString()
			};
		} else if (verdict.status !== 'valid') {
			return {
				kind: 'error',
				message: staffPersonQrRejectionMessage(verdict),
				...(verdict.status === 'expired' ? { expiredQr: true as const } : {})
			};
		}
	}

	const evacuee = await deps.lookupEvacuee(personQr?.evacuee_id ?? code);
	if (!evacuee) {
		return {
			kind: 'error',
			message: `ไม่พบผู้ประสบภัยจากรหัส "${code}" ลองสแกนใหม่หรือค้นหาด้วยชื่อ`
		};
	}
	return qrOverride ? { kind: 'evacuee', evacuee, qrOverride } : { kind: 'evacuee', evacuee };
}

/** Name / nickname / phone / `V-NNN` match over an already-loaded volunteer list. */
export function searchVolunteers(
	volunteers: readonly Volunteer[],
	term: string,
	limit = 5
): Volunteer[] {
	const q = term.trim().toLowerCase();
	if (!q) return [];
	return volunteers
		.filter((v) =>
			[v.first_name, v.last_name, v.nickname ?? '', v.phone ?? '', v.volunteer_code]
				.join(' ')
				.toLowerCase()
				.includes(q)
		)
		.slice(0, limit);
}
