/**
 * Progress of reading a Thai ID card on the walk-in registration screen.
 *
 * scanner_client reports it as `kiosk:smart-card-progress` events: `data` counts the nine text
 * fields, `photo` the 20 photo chunks. The photo is almost all of the time, so the bar gives the
 * text fields a small share up front and spreads the rest over the photo chunks.
 */

export type CardReadPhase = 'data' | 'photo';

/** Steps the screen lists, in order. `saving` is the registration request after the card is read. */
export type CardReadStage = CardReadPhase | 'saving';

export type CardReadProgress = { phase: CardReadPhase; done: number; total: number };

/** Share of the bar taken by reading the card reset and the text fields. */
const DATA_SHARE = 15;

export const CARD_READ_STAGES: readonly CardReadStage[] = ['data', 'photo', 'saving'];

/** The event detail from scanner_client, or null when it is not a well-formed progress report. */
export function parseCardReadProgress(detail: unknown): CardReadProgress | null {
	if (typeof detail !== 'object' || detail === null) return null;
	const { phase, done, total } = detail as Record<string, unknown>;
	if (phase !== 'data' && phase !== 'photo') return null;
	if (typeof done !== 'number' || typeof total !== 'number') return null;
	if (!Number.isInteger(done) || !Number.isInteger(total) || total <= 0 || done < 0) return null;
	return { phase, done: Math.min(done, total), total };
}

/** Whole percent of the bar for one report, 0–100. */
export function cardReadPercent({ phase, done, total }: CardReadProgress): number {
	const fraction = done / total;
	const percent =
		phase === 'data' ? DATA_SHARE * fraction : DATA_SHARE + (100 - DATA_SHARE) * fraction;
	return Math.round(percent);
}

/**
 * The bar never goes backwards: after a hiccup the reader may start the photo over, and a bar that
 * shrinks looks like a failure.
 */
export function advanceCardReadPercent(current: number, next: CardReadProgress): number {
	return Math.max(current, cardReadPercent(next));
}

export function cardReadStatusText(stage: CardReadStage): string {
	switch (stage) {
		case 'data':
			return 'กำลังอ่านข้อมูลบัตร';
		case 'photo':
			return 'กำลังอ่านรูปถ่าย';
		case 'saving':
			return 'กำลังบันทึกข้อมูล';
	}
}
