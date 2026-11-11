import { z } from 'zod';
import { toPersistBirthYearBE } from './birth-calendar';
import { currentBEYear, genderSchema } from './people';
import type { UnifiedMemberWithMeta } from './unified-registration';

/** A Thai ID card read by the desktop scanner client (`scanner:card-read` detail, issue #1326). */
export const scannerCardSchema = z.object({
	citizen_id: z.string().min(1),
	first_name_th: z.string(),
	last_name_th: z.string(),
	gender: genderSchema,
	/** Gregorian (CE) year; some cards carry no date of birth. */
	birth_year_ce: z.number().int().optional(),
	age: z.number().int().optional()
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
