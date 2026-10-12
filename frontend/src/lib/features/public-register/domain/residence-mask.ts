const graphemeSegmenter = new Intl.Segmenter('th', { granularity: 'grapheme' });

/**
 * Masked surname for a public residence-match card. Mirrors the FastAPI
 * `mask_last_name` (backend/apiapp/utils/masking.py): splits on grapheme clusters so a
 * Thai vowel or tone mark never floats alone next to the asterisks.
 *
 * - ≤ 4 graphemes: first grapheme + `****`
 * - ≥ 5 graphemes: first 2 + `****` + last 2
 * - blank: empty string (the card then shows the first name only)
 */
export function maskLastName(lastName: string | null | undefined): string {
	const trimmed = lastName?.trim();
	if (!trimmed) return '';
	const graphemes = Array.from(graphemeSegmenter.segment(trimmed), (s) => s.segment);
	if (graphemes.length <= 4) return `${graphemes[0]}****`;
	return `${graphemes[0]}${graphemes[1]}****${graphemes.at(-2)}${graphemes.at(-1)}`;
}

/** First name + masked surname — the only member detail a public joiner may see. */
export function maskedMemberName(
	firstName: string | null | undefined,
	lastName?: string | null
): string {
	return `${firstName ?? ''} ${maskLastName(lastName)}`.trim();
}
