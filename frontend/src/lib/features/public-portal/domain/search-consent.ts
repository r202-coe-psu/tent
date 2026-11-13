/**
 * CR-231 — consent + purpose the searcher gives before a public family search. Pure: mirrors the
 * backend `PublicSearchRequest` rules (backend/apiapp/modules/evacuee/schemas.py) so the dialog
 * never sends a body FastAPI would 422.
 */
import { z } from 'zod';

export const SEARCH_PURPOSES = [
	'find_family',
	'find_acquaintance',
	'coordinate_aid',
	'other'
] as const;
export type SearchPurpose = (typeof SEARCH_PURPOSES)[number];

export const SEARCH_NAME_MAX = 100;
export const SEARCH_PURPOSE_NOTE_MAX = 200;
const THAI_MOBILE = /^0\d{9}$/;

/** Keys the dialog can show an error under. */
export type SearchConsentField =
	'first_name' | 'last_name' | 'phone' | 'purpose' | 'purpose_note' | 'consent_accepted';

/** Phone as typed ("081-234 5678") → bare digits; the backend regex runs before it normalises. */
function stripPhoneSeparators(value: string): string {
	return value.replace(/[\s-]+/g, '');
}

export const searchConsentSchema = z
	.object({
		searcher: z.object({
			first_name: z.string().trim().min(1).max(SEARCH_NAME_MAX),
			last_name: z.string().trim().max(SEARCH_NAME_MAX).default(''),
			phone: z.string().transform(stripPhoneSeparators).pipe(z.string().regex(THAI_MOBILE))
		}),
		purpose: z.enum(SEARCH_PURPOSES),
		purpose_note: z.string().nullish(),
		consent_accepted: z.literal(true)
	})
	.transform((value, ctx) => {
		const note = value.purpose_note?.trim() ?? '';
		if (value.purpose === 'other') {
			if (note.length < 1 || note.length > SEARCH_PURPOSE_NOTE_MAX) {
				ctx.issues.push({
					code: 'custom',
					message: 'purpose_note required for other (1-200)',
					path: ['purpose_note'],
					input: value.purpose_note
				});
				return z.NEVER;
			}
		} else if (note) {
			ctx.issues.push({
				code: 'custom',
				message: 'purpose_note only allowed for other',
				path: ['purpose_note'],
				input: value.purpose_note
			});
			return z.NEVER;
		}
		const base = {
			searcher: value.searcher,
			purpose: value.purpose,
			consent_accepted: value.consent_accepted
		};
		return value.purpose === 'other' ? { ...base, purpose_note: note } : base;
	});

/** What leaves the browser: `purpose_note` is present only for `other`. */
export type SearchConsent = z.output<typeof searchConsentSchema>;
export type SearchConsentInput = z.input<typeof searchConsentSchema>;

export type SearchConsentResult =
	| { ok: true; consent: SearchConsent }
	| { ok: false; errors: Partial<Record<SearchConsentField, true>> };

/** Validate raw dialog values; on failure report which fields are wrong. */
export function parseSearchConsent(input: unknown): SearchConsentResult {
	const parsed = searchConsentSchema.safeParse(input);
	if (parsed.success) return { ok: true, consent: parsed.data };
	const errors: Partial<Record<SearchConsentField, true>> = {};
	for (const issue of parsed.error.issues) {
		const [head, sub] = issue.path;
		const key = head === 'searcher' ? sub : head;
		if (typeof key === 'string') errors[key as SearchConsentField] = true;
	}
	return { ok: false, errors };
}
