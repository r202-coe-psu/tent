import type { Evacuee } from '$lib/features/people';
import { parseVolunteerScanCode, type Volunteer } from '$lib/features/volunteers';
import type { FrontlineRecipientSelection } from './frontline-handover';

/**
 * Recipient-picker scan routing (#650): one scanner takes both evacuee cards and volunteer
 * passes. Pure over injected lookups so the routing is testable without a component.
 */
export type ScannedRecipient =
	| { kind: 'evacuee'; evacuee: Evacuee }
	| { kind: 'volunteer'; volunteer: Volunteer }
	| { kind: 'error'; message: string };

export interface RecipientScanDeps {
	lookupEvacuee: (code: string) => Promise<Evacuee | null>;
	lookupVolunteer: (code: string) => Promise<Volunteer | null>;
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
	options: { allowVolunteer: boolean },
	deps: RecipientScanDeps
): Promise<ScannedRecipient> {
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

	const evacuee = await deps.lookupEvacuee(code);
	if (!evacuee) {
		return {
			kind: 'error',
			message: `ไม่พบผู้ประสบภัยจากรหัส "${code}" ลองสแกนใหม่หรือค้นหาด้วยชื่อ`
		};
	}
	return { kind: 'evacuee', evacuee };
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
