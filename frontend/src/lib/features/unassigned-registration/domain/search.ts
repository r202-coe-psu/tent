/**
 * Unassigned Registration staff search types (CR-113 / #245).
 * Mongo central queue — not Evacuee until claim.
 */

import { z } from 'zod';
import { evacueeConsentSchema } from '$lib/features/consent/server';
import { CR112_VULNERABLE_GROUP_ACTIVE, formatMasterLabel } from '$lib/features/master-data';
import { formatThaiDateTime } from '$lib/utils/date';
import type { LanguageCode } from '$lib/utils/language';

/** Full Station 1 badge copy for Unassigned Registration hits (#250 / CR-113). */
export const UNASSIGNED_QUEUE_BADGE_LABEL = 'คิวกลาง / ยังไม่ระบุศูนย์';

/** Compact badge text matching AC `[คิวกลาง]`. */
export const UNASSIGNED_QUEUE_BADGE_SHORT = 'คิวกลาง';

/**
 * Shared Station 1 claim-flow copy (banner + claim dialog).
 * Ticking here only selects — claim + Couch birth happen later, when staff confirm
 * on the review/Report-in page (CR-140 addendum). Nothing is written until that confirm.
 */
export const CLAIM_FLOW_STATUS_GUIDANCE =
	'เลือกสมาชิกและสัตว์เลี้ยงที่จะรับเข้าศูนย์นี้ แล้วไปหน้าตรวจสอบรายละเอียด — ยังไม่มีการรับเข้าศูนย์จนกว่าจะกดยืนยันในหน้านั้น จากนั้นจึงสร้าง Evacuee ใน Couch (pre_registered) แล้วเลื่อนเป็น มาถึงศูนย์ / รอคัดกรอง (arriving) ทันที';

/** Short a11y description for the claim dialog (not the status-flow lecture). */
export const CLAIM_DIALOG_DESCRIPTION =
	'เลือกสมาชิกและสัตว์เลี้ยงที่ยัง open — ยังไม่รับเข้าศูนย์ตอนนี้ ต้องตรวจสอบรายละเอียดอีกขั้นก่อน';

const personIdHitSchema = z.object({
	cardType: z.enum(['national_id', 'passport', 'pink_card', 'other', 'anonymous']),
	number: z.string().nullable()
});

const emergencyContactHitSchema = z.object({
	name: z.string(),
	phone: z.string(),
	relation: z.string()
});

/**
 * Owner of the open-member search/claim hit shape — claim + review import this.
 * `nickname`/`religion`/`emergency_contact`/`photo`/`birth_year`/`age` are optional here
 * (search cards don't render them) but present on the FastAPI `OpenMemberHit` payload —
 * the review page (CR-140 addendum) needs them to prefill the full registration form.
 */
export const openMemberHitSchema = z.object({
	reserved_evacuee_id: z.string(),
	status: z.literal('open'),
	first_name: z.string(),
	last_name: z.string(),
	/** `null` = ไม่ระบุ (decision sync 2026-10-09); legacy `'other'` also reads as ไม่ระบุ. */
	gender: z.string().nullable(),
	phone: z.string().nullable(),
	person_id: personIdHitSchema.nullable(),
	country: z.string(),
	vulnerable_groups: z.array(z.string()),
	special_needs: z.array(z.string()),
	nickname: z.string().nullable().optional(),
	religion: z.string().nullable().optional(),
	religion_other: z.string().nullable().optional(),
	disability_other_detail: z.string().nullable().optional(),
	emergency_contact: emergencyContactHitSchema.nullable().optional(),
	photo: z.string().nullable().optional(),
	birth_year: z.number().int().nullable().optional(),
	age: z.number().int().nullable().optional(),
	/** Consent given on the public form; absent for members queued before it (FR-44). */
	consent: evacueeConsentSchema.nullable().optional(),
	search_excluded: z.boolean().optional()
});

export const openPetHitSchema = z.object({
	pet_id: z.string(),
	status: z.literal('open'),
	species: z.enum(['dog', 'cat', 'other']),
	count: z.number().int().positive(),
	notes: z.string().nullable().optional(),
	has_cage: z.boolean().optional(),
	image_url: z.string().nullable().optional()
});

export type PersonIdHit = z.infer<typeof personIdHitSchema>;
export type OpenMemberHit = z.infer<typeof openMemberHitSchema>;
export type OpenPetHit = z.infer<typeof openPetHitSchema>;

export type PetSummarySource = {
	species: OpenPetHit['species'];
	count: number;
	notes?: string | null;
	has_cage?: boolean;
};

export type ClaimedPetSummary = {
	species: OpenPetHit['species'];
	count: number;
	details?: string;
};

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

const PET_SPECIES_LABELS: Record<OpenPetHit['species'], string> = {
	dog: 'สุนัข',
	cat: 'แมว',
	other: 'อื่น ๆ'
};

/** Display copy for the claim flow; the Thai side reuses the constants and maps above/below. */
export type UnassignedSearchCopy = {
	badgeLabel: string;
	badgeShort: string;
	claimFlowStatusGuidance: string;
	claimDialogDescription: string;
	cardType: Record<PersonIdHit['cardType'], string>;
	/** `unspecified` covers `null` and any gender other than male / female. */
	gender: { male: string; female: string; unspecified: string };
	petSpecies: Record<OpenPetHit['species'], string>;
	noPhone: string;
	noIdNumber: string;
	hasCage: string;
};

/** English mirror of the Thai copy in this file — the Thai strings stay the source of truth. */
export const unassignedSearchCopyByLanguage: Record<LanguageCode, UnassignedSearchCopy> = {
	th: {
		badgeLabel: UNASSIGNED_QUEUE_BADGE_LABEL,
		badgeShort: UNASSIGNED_QUEUE_BADGE_SHORT,
		claimFlowStatusGuidance: CLAIM_FLOW_STATUS_GUIDANCE,
		claimDialogDescription: CLAIM_DIALOG_DESCRIPTION,
		cardType: CARD_TYPE_LABELS,
		gender: { male: GENDER_LABELS.male, female: GENDER_LABELS.female, unspecified: 'ไม่ระบุ' },
		petSpecies: PET_SPECIES_LABELS,
		noPhone: 'ไม่มีเบอร์',
		noIdNumber: 'ไม่มีเลขบัตร',
		hasCage: 'มีกรง'
	},
	en: {
		badgeLabel: 'Central queue / shelter not yet assigned',
		badgeShort: 'Central queue',
		claimFlowStatusGuidance:
			'Select the members and pets to admit to this shelter, then go to the review page. Nobody is admitted until you confirm there. Confirming creates the Evacuee in Couch (pre_registered) and immediately moves them to Arrived / awaiting screening (arriving).',
		claimDialogDescription:
			'Select the members and pets that are still open. They are not admitted yet; the details must be reviewed first.',
		cardType: {
			national_id: 'National ID card',
			passport: 'Passport',
			pink_card: 'Pink card',
			other: 'Other document',
			anonymous: 'Anonymous'
		},
		gender: { male: 'Male', female: 'Female', unspecified: 'Not specified' },
		petSpecies: { dog: 'Dog', cat: 'Cat', other: 'Other' },
		noPhone: 'No phone',
		noIdNumber: 'No ID number',
		hasCage: 'Has cage'
	}
};

export interface UnassignedRegistrationSearchHit {
	id: string;
	reserved_household_id: string;
	registered_via: 'web' | 'staff';
	status: string;
	created_at: string;
	open_members: OpenMemberHit[];
	open_pets?: OpenPetHit[];
}

export interface UnassignedRegistrationSearchResponse {
	results: UnassignedRegistrationSearchHit[];
}

export function formatOpenMemberName(member: OpenMemberHit): string {
	return `${member.first_name} ${member.last_name}`.trim();
}

export function formatOpenMemberGender(
	gender: string | null | undefined,
	language: LanguageCode = 'th'
): string {
	const labels = unassignedSearchCopyByLanguage[language].gender;
	return gender === 'male' || gender === 'female' ? labels[gender] : labels.unspecified;
}

export function formatOpenMemberCardType(
	cardType: PersonIdHit['cardType'],
	language: LanguageCode = 'th'
): string {
	return unassignedSearchCopyByLanguage[language].cardType[cardType];
}

export function formatOpenMemberVulnerableGroup(
	code: string,
	language: LanguageCode = 'th'
): string {
	const hit = CR112_VULNERABLE_GROUP_ACTIVE.find((item) => item.code === code);
	return hit ? formatMasterLabel(hit, language) : code;
}

/** Phone · card type · ID number for claim-dialog identity line. */
export function formatOpenMemberIdentityLine(
	member: OpenMemberHit,
	language: LanguageCode = 'th'
): string {
	const copy = unassignedSearchCopyByLanguage[language];
	const phone = member.phone ?? copy.noPhone;
	if (!member.person_id) {
		return `${phone} · ${copy.noIdNumber}`;
	}
	const cardLabel = formatOpenMemberCardType(member.person_id.cardType, language);
	const number = member.person_id.number ?? copy.noIdNumber;
	return `${phone} · ${cardLabel} · ${number}`;
}

/** Gender · country for claim-dialog demographics line. */
export function formatOpenMemberDemographicsLine(
	member: OpenMemberHit,
	language: LanguageCode = 'th'
): string {
	return `${formatOpenMemberGender(member.gender, language)} · ${member.country}`;
}

export function formatOpenPetLabel(pet: OpenPetHit, language: LanguageCode = 'th'): string {
	const species = unassignedSearchCopyByLanguage[language].petSpecies[pet.species] ?? pet.species;
	const countPart = pet.count > 1 ? ` ×${pet.count}` : '';
	const notes = pet.notes?.trim();
	return notes ? `${species}${countPart} (${notes})` : `${species}${countPart}`;
}

export function petsLeftBehind(
	openPets: readonly OpenPetHit[],
	selectedPetIds: readonly string[]
): OpenPetHit[] {
	const selected = new Set(selectedPetIds);
	return openPets.filter((pet) => !selected.has(pet.pet_id));
}

export function totalOpenPetCount(pets: readonly OpenPetHit[]): number {
	return pets.reduce((sum, pet) => sum + pet.count, 0);
}

export function claimedPetSummaries(
	pets: readonly PetSummarySource[],
	language: LanguageCode = 'th'
): ClaimedPetSummary[] {
	const { hasCage } = unassignedSearchCopyByLanguage[language];
	return pets.map((pet) => {
		const details = [pet.notes?.trim(), pet.has_cage ? hasCage : '']
			.filter((part): part is string => Boolean(part))
			.join(' · ');
		return details
			? { species: pet.species, count: pet.count, details }
			: { species: pet.species, count: pet.count };
	});
}

/** Thai-locale date+time for claim registration header. */
export function formatClaimCreatedAt(iso: string): string {
	return formatThaiDateTime(iso) || iso;
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
