/**
 * Unassigned Registration staff search types (CR-113 / #245).
 * Mongo central queue — not Evacuee until claim.
 */

import { z } from 'zod';
import { CR112_VULNERABLE_GROUP_ACTIVE, formatMasterLabel } from '$lib/features/master-data';

/** Full Station 1 badge copy for Unassigned Registration hits (#250 / CR-113). */
export const UNASSIGNED_QUEUE_BADGE_LABEL = 'คิวกลาง / ยังไม่ระบุศูนย์';

/** Compact badge text matching AC `[คิวกลาง]`. */
export const UNASSIGNED_QUEUE_BADGE_SHORT = 'คิวกลาง';

/**
 * Shared Station 1 claim-flow copy (banner + claim dialog).
 * Claim births Couch at `pre_registered` (CR-113); Report-in submit sets `arriving` (CR-106).
 */
export const CLAIM_FLOW_STATUS_GUIDANCE =
	'รับเข้าศูนย์จะสร้าง Evacuee ใน Couch ที่สถานะ ลงทะเบียนล่วงหน้า (pre_registered) จากนั้นเปิดหน้า รายงานตัว (Report-in) เพื่อยืนยันข้อมูล แล้วเลื่อนเป็น มาถึงศูนย์ / รอคัดกรอง (arriving)';

/** Short a11y description for the claim dialog (not the status-flow lecture). */
export const CLAIM_DIALOG_DESCRIPTION = 'เลือกสมาชิกที่จะรับเข้าศูนย์นี้ แล้วกดยืนยัน';

const personIdHitSchema = z.object({
	cardType: z.enum(['national_id', 'passport', 'pink_card', 'other', 'anonymous']),
	number: z.string().nullable()
});

/** Owner of the open-member search/claim hit shape — claim imports this. */
export const openMemberHitSchema = z.object({
	reserved_evacuee_id: z.string(),
	status: z.literal('open'),
	first_name: z.string(),
	last_name: z.string(),
	gender: z.string(),
	phone: z.string().nullable(),
	person_id: personIdHitSchema.nullable(),
	country: z.string(),
	vulnerable_groups: z.array(z.string()),
	special_needs: z.array(z.string())
});

export type PersonIdHit = z.infer<typeof personIdHitSchema>;
export type OpenMemberHit = z.infer<typeof openMemberHitSchema>;
export type OpenMemberStatus = OpenMemberHit['status'];

const CARD_TYPE_LABELS: Record<PersonIdHit['cardType'], string> = {
	national_id: 'บัตรประชาชน',
	passport: 'พาสปอร์ต',
	pink_card: 'บัตรชมพู',
	other: 'เอกสารอื่น',
	anonymous: 'ไม่ระบุตัวตน'
};

const GENDER_LABELS: Record<string, string> = {
	male: 'ชาย',
	female: 'หญิง'
};

export interface UnassignedRegistrationSearchHit {
	id: string;
	reserved_household_id: string;
	registered_via: 'web' | 'staff';
	status: string;
	created_at: string;
	open_members: OpenMemberHit[];
}

export interface UnassignedRegistrationSearchResponse {
	results: UnassignedRegistrationSearchHit[];
}

export function formatOpenMemberName(member: OpenMemberHit): string {
	return `${member.first_name} ${member.last_name}`.trim();
}

export function formatOpenMemberGender(gender: string): string {
	return GENDER_LABELS[gender] ?? gender;
}

export function formatOpenMemberCardType(cardType: PersonIdHit['cardType']): string {
	return CARD_TYPE_LABELS[cardType];
}

export function formatOpenMemberVulnerableGroup(code: string): string {
	const hit = CR112_VULNERABLE_GROUP_ACTIVE.find((item) => item.code === code);
	return hit ? formatMasterLabel(hit, 'th') : code;
}

/** Phone · card type · ID number for claim-dialog identity line. */
export function formatOpenMemberIdentityLine(member: OpenMemberHit): string {
	const phone = member.phone ?? 'ไม่มีเบอร์';
	if (!member.person_id) {
		return `${phone} · ไม่มีเลขบัตร`;
	}
	const cardLabel = formatOpenMemberCardType(member.person_id.cardType);
	const number = member.person_id.number ?? 'ไม่มีเลขบัตร';
	return `${phone} · ${cardLabel} · ${number}`;
}

/** Gender · country for claim-dialog demographics line. */
export function formatOpenMemberDemographicsLine(member: OpenMemberHit): string {
	return `${formatOpenMemberGender(member.gender)} · ${member.country}`;
}

/** Thai-locale date+time for claim registration header. */
export function formatClaimCreatedAt(iso: string): string {
	try {
		return new Date(iso).toLocaleString('th-TH', {
			dateStyle: 'medium',
			timeStyle: 'short'
		});
	} catch {
		return iso;
	}
}

/** True when FastAPI / BFF signal that central Mongo (or auth) is unreachable. */
export function isOnlineRequiredError(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	const code =
		'code' in error && typeof error.code === 'string'
			? error.code
			: 'error' in error &&
				  typeof error.error === 'object' &&
				  error.error !== null &&
				  'code' in error.error &&
				  typeof (error.error as { code: unknown }).code === 'string'
				? (error.error as { code: string }).code
				: null;
	return code === 'ONLINE_REQUIRED';
}
