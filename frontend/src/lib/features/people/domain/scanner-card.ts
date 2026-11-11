import { z } from 'zod';
import type { UnifiedMemberWithMeta } from './unified-registration';

/** A Thai ID card read by the desktop scanner client (`scanner:card-read` detail, issue #1326). */
export const scannerCardSchema = z.object({
	citizen_id: z.string().min(1),
	first_name_th: z.string(),
	last_name_th: z.string()
});

export type ScannerCard = z.infer<typeof scannerCardSchema>;

/** Fill a registration member from a scanned card; the card wins for the fields it carries. */
export function cardToUnifiedMember(
	card: ScannerCard,
	base: UnifiedMemberWithMeta
): UnifiedMemberWithMeta {
	return {
		...base,
		first_name: card.first_name_th,
		last_name: card.last_name_th,
		person_id: { cardType: 'national_id', number: card.citizen_id }
	};
}
