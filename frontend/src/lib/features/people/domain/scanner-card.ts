import { z } from 'zod';
import { toPersistBirthYearBE } from './birth-calendar';
import { currentBEYear, genderSchema } from './people';
import {
	cardAddressToHouseholdFields,
	type UnifiedHouseholdInput,
	type UnifiedMemberWithMeta
} from './unified-registration';

const citizenIdSchema = z.string().regex(/^\d{13}$/);

/** A Thai ID card read by the desktop scanner client (`scanner:card-read` detail, issue #1326). */
export const scannerCardSchema = z.object({
	citizen_id: citizenIdSchema,
	first_name_th: z.string(),
	last_name_th: z.string(),
	gender: genderSchema,
	/** Date of birth as printed on the card (ISO-like string, Buddhist-Era year possible). */
	birth_date: z.string().optional(),
	/** Gregorian (CE) year; some cards carry no date of birth. */
	birth_year_ce: z.number().int().optional(),
	age: z.number().int().optional(),
	address_no: z.string().optional(),
	village_no: z.string().optional(),
	lane: z.string().optional(),
	road: z.string().optional(),
	subdistrict: z.string().optional(),
	district: z.string().optional(),
	province: z.string().optional(),
	/** When the client read the card (ISO 8601 timestamp). */
	scanned_at: z.string().min(1)
});

export type ScannerCard = z.infer<typeof scannerCardSchema>;

/** A card photo from the scanner client (`scanner:card-photo` detail): a JPEG data URL for one citizen ID. */
export const scannerCardPhotoSchema = z.object({
	citizen_id: citizenIdSchema,
	photo_base64: z.string().regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)
});

export type ScannerCardPhoto = z.infer<typeof scannerCardPhotoSchema>;

/** Fill a registration member from a scanned card; the card wins for the fields it carries. */
export function cardToUnifiedMember(
	card: ScannerCard,
	base: UnifiedMemberWithMeta
): UnifiedMemberWithMeta {
	const member: UnifiedMemberWithMeta = {
		...base,
		first_name: card.first_name_th,
		last_name: card.last_name_th,
		gender: card.gender,
		person_id: { cardType: 'national_id', number: card.citizen_id }
	};
	if (card.birth_year_ce !== undefined) {
		const birthYearBE = toPersistBirthYearBE(card.birth_year_ce, 'CE');
		member.birth_year = birthYearBE;
		member.age = card.age ?? Math.max(0, currentBEYear() - birthYearBE);
	}
	return member;
}

const ADDRESS_KEYS = [
	'address_no',
	'village_no',
	'subdistrict',
	'district',
	'province',
	'postal_code'
] as const satisfies readonly (keyof UnifiedHouseholdInput)[];

/**
 * Fill the household address from a scanned card, normalized like the report-in card autofill.
 * Only when the address is still empty (every address part blank): a later card never overwrites it.
 */
export function applyCardAddressToHousehold<H extends UnifiedHouseholdInput>(
	household: H,
	card: ScannerCard
): H {
	if (ADDRESS_KEYS.some((key) => household[key]?.trim())) return household;
	return { ...household, ...cardAddressToHouseholdFields(card) };
}

export type ScannedCardPlacement =
	| { kind: 'fill'; index: number }
	| { kind: 'already-in-form'; index: number }
	| { kind: 'ask-overwrite' };

const digitsOnly = (value: string | undefined) => (value ?? '').replace(/\D/g, '');

/**
 * Decide where a scanned card goes: onto the member that already carries its citizen ID, else the
 * first empty member (no first name, no ID number), else ask staff before overwriting someone.
 */
export function applyScannedCard(
	members: readonly UnifiedMemberWithMeta[],
	card: ScannerCard
): ScannedCardPlacement {
	const cardId = digitsOnly(card.citizen_id);
	const existing = cardId
		? members.findIndex((m) => digitsOnly(m.person_id?.number) === cardId)
		: -1;
	if (existing !== -1) return { kind: 'already-in-form', index: existing };
	const empty = members.findIndex((m) => !m.first_name.trim() && !m.person_id?.number?.trim());
	if (empty !== -1) return { kind: 'fill', index: empty };
	return { kind: 'ask-overwrite' };
}

/** Who a scanned card's citizen ID already belongs to (shelter or central queue), and where to open them. */
export type ScannedCardDuplicate = { name: string; href: string };
