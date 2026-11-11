import { z } from 'zod';
import { toPersistBirthYearBE } from './birth-calendar';
import { currentBEYear, genderSchema } from './people';
import {
	cardAddressToHouseholdFields,
	type UnifiedHouseholdInput,
	type UnifiedMemberWithMeta
} from './unified-registration';

/** A Thai ID card read by the desktop scanner client (`scanner:card-read` detail, issue #1326). */
export const scannerCardSchema = z.object({
	citizen_id: z.string().min(1),
	first_name_th: z.string(),
	last_name_th: z.string(),
	gender: genderSchema,
	/** Gregorian (CE) year; some cards carry no date of birth. */
	birth_year_ce: z.number().int().optional(),
	age: z.number().int().optional(),
	address_no: z.string().optional(),
	village_no: z.string().optional(),
	lane: z.string().optional(),
	road: z.string().optional(),
	subdistrict: z.string().optional(),
	district: z.string().optional(),
	province: z.string().optional()
});

export type ScannerCard = z.infer<typeof scannerCardSchema>;

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
